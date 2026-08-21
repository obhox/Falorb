import { createContext } from "./context";
import { Watermarks } from "./scheduler";
import { resolveIdentities } from "./jobs/identity-resolver";
import { sessionize } from "./jobs/sessionizer";
import { optimizeAggregates, rebuildPathTransitions, refreshSegmentCounts } from "./jobs/rollups";
import { enrichCompanies } from "./jobs/enrichment";
import { listenReddit } from "./jobs/reddit-listener";
import { scoreInterests } from "./jobs/interest-scorer";
import { evaluateAlerts } from "./jobs/alerts";
import { dispatchWebhooks, reviveWebhooks } from "./jobs/webhooks";
import { enforceRetention, processDataRequests, pruneOrphanedPersons } from "./jobs/retention-gc";
import { syncLinki } from "./jobs/linki-sync";
import { syncBundAi } from "./jobs/bund-ai-sync";
import { syncBuffer } from "./jobs/buffer-sync";

/**
 * Runs every scheduled job once, in dependency order.
 *
 * The scheduler spaces these out over hours, which makes "does the enrichment
 * job actually work" impractical to answer by waiting. This forces each one
 * through against a live database so that a broken query surfaces immediately
 * rather than six hours after deploy.
 */

let passed = 0;
let failed = 0;

async function run(name: string, fn: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  try {
    const result = await fn();
    const detail = typeof result === "number" ? `→ ${result}` : "";
    console.log(`  ✓ ${name.padEnd(22)} ${String(Date.now() - started).padStart(5)}ms ${detail}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name.padEnd(22)} ${String(error).split("\n")[0]}`);
    failed++;
  }
}

const context = await createContext();
const watermarks = new Watermarks(context.redis);

console.log(`\nrunning all jobs against ${context.projectIds.length} projects\n`);

await run("identity-resolver", () =>
  resolveIdentities({
    db: context.db,
    clickhouse: context.clickhouse,
    watermarks,
    projectOrgs: context.projectOrgs,
    orgScopedProjects: context.orgScopedProjects,
  }),
);
await run("sessionizer", () => sessionize(context, watermarks));
await run("path-transitions", () => rebuildPathTransitions(context));
await run("segment-counts", () => refreshSegmentCounts(context));
await run("interest-scorer", () => scoreInterests(context, watermarks));
await run("enrichment", () => enrichCompanies(context, watermarks));
// clay-enrichment deliberately excluded: it spends a connected org's own
// paid Clay credits, unlike every other job here which only touches
// Falorb-controlled resources. See apps/worker/src/jobs/clay-enrichment.ts.
await run("reddit-listener", () => listenReddit(context, watermarks));
await run("alerts", () => evaluateAlerts(context));
await run("webhooks", () => dispatchWebhooks(context, watermarks));
await run("webhook-revive", () => reviveWebhooks(context));
await run("data-requests", () => processDataRequests(context));
// No-ops cleanly with zero connected orgs — still worth running here so a
// broken query surfaces the moment a first org connects, not weeks later.
await run("linki-sync", () => syncLinki(context));
await run("bund-ai-sync", () => syncBundAi(context));
await run("buffer-sync", () => syncBuffer(context));
await run("retention", () => enforceRetention(context));
await run("prune-orphans", () => pruneOrphanedPersons(context));
await run("optimize", () => optimizeAggregates(context));

await context.clickhouse.close();
context.redis.disconnect();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

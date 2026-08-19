import { createClickHouse } from "@falorb/db";
import {
  acquisitionChain,
  attribution,
  goalConversions,
  breakdown,
  closedSessions,
  crossProjectPeople,
  entryPages,
  exitPages,
  frustration,
  funnel,
  funnelDropoffs,
  liveCounts,
  liveFeed,
  liveVisitors,
  pathTransitions,
  topDropoffs,
  personInterests,
  personList,
  personProjects,
  personTimeline,
  portfolioOverview,
  portfolioSparklines,
  retention,
  sessionEvents,
  sessionList,
  stickiness,
  totals,
  trend,
  type DateRange,
} from "./index";

/**
 * Executes every query builder against a live ClickHouse.
 *
 * Unit tests prove the filter compiler is safe, but they cannot prove the
 * generated SQL is *valid* — only ClickHouse can do that. This catches the
 * class of error that unit tests structurally miss: a wrong combinator, an
 * aggregate nested where ClickHouse forbids it, a column that does not exist.
 */

const PROJECTS = [1, 2, 3];
const now = Date.now();
const range: DateRange = { from: now - 30 * 86_400_000, to: now + 86_400_000 };
const scope = { projectIds: PROJECTS, range };

let passed = 0;
let failed = 0;

async function check(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const result = await run();
    const count = Array.isArray(result) ? result.length : 1;
    const preview = Array.isArray(result) ? `${count} rows` : summarize(result);
    console.log(`  ✓ ${name.padEnd(28)} ${preview}`);
    passed++;
  } catch (error) {
    const message = String(error).split("\n")[0];
    console.log(`  ✗ ${name.padEnd(28)} ${message}`);
    failed++;
  }
}

function summarize(value: unknown): string {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  }
  return String(value);
}

async function main(): Promise<void> {
  const client = createClickHouse();

  console.log("\ntrends & breakdowns");
  await check("totals", () => totals(client, scope));
  await check("trend visitors", () => trend(client, { ...scope, metric: "visitors" }));
  await check("trend revenue", () => trend(client, { ...scope, metric: "revenue" }));
  await check("trend bounce_rate", () => trend(client, { ...scope, metric: "bounce_rate" }));
  await check("trend w/ breakdown", () =>
    trend(client, { ...scope, metric: "visitors", breakdown: "channel" }),
  );
  await check("breakdown path", () => breakdown(client, { ...scope, field: "path" }));
  await check("breakdown prop", () => breakdown(client, { ...scope, field: "prop:content_tag" }));
  await check("breakdown filtered", () =>
    breakdown(client, {
      ...scope,
      field: "source",
      filters: [{ field: "device_type", op: "eq", value: "mobile" }],
    }),
  );

  console.log("\nfunnels");
  const steps = [
    { label: "Home", event: "$pageview", filters: [{ field: "path", op: "eq" as const, value: "/" }] },
    {
      label: "Pricing",
      event: "$pageview",
      filters: [{ field: "path", op: "eq" as const, value: "/pricing" }],
    },
    {
      label: "Signup",
      event: "$pageview",
      filters: [{ field: "path", op: "eq" as const, value: "/signup" }],
    },
  ];
  await check("funnel", () => funnel(client, { ...scope, projectIds: [2], steps }));
  await check("funnel strict", () =>
    funnel(client, { ...scope, projectIds: [2], steps, mode: "strict" }),
  );
  await check("funnel dropoffs", () =>
    funnelDropoffs(client, { ...scope, projectIds: [2], steps, atStep: 2 }),
  );

  console.log("\ngoals & attribution");
  const goalDefs = [
    { id: "g1", name: "Signup", kind: "path" as const, matcher: "/signup", value: 50 },
    { id: "g2", name: "Any pricing view", kind: "path" as const, matcher: "/pricing*" },
    { id: "g3", name: "Revenue event", kind: "event" as const, matcher: "$revenue" },
  ];
  await check("goal conversions", () => goalConversions(client, { ...scope, goals: goalDefs }));
  await check("attribution first", () =>
    attribution(client, { ...scope, goal: goalDefs[0]!, model: "first_touch" }),
  );
  await check("attribution last", () =>
    attribution(client, { ...scope, goal: goalDefs[0]!, model: "last_touch" }),
  );
  await check("attribution linear", () =>
    attribution(client, { ...scope, goal: goalDefs[0]!, model: "linear" }),
  );

  console.log("\nretention");
  await check("retention weekly", () => retention(client, { projectIds: PROJECTS, range }));
  await check("retention daily", () =>
    retention(client, { projectIds: PROJECTS, range, granularity: "day", periods: 7 }),
  );
  await check("stickiness", () => stickiness(client, { projectIds: PROJECTS, range }));

  console.log("\npaths & drop-off");
  await check("path transitions", () => pathTransitions(client, scope));
  await check("exit pages", () => exitPages(client, { ...scope, minPageviews: 1 }));
  await check("entry pages", () => entryPages(client, scope));
  await check("frustration", () => frustration(client, scope));
  await check("top dropoffs", () => topDropoffs(client, { ...scope, minPageviews: 1 }));

  console.log("\nsessions");
  await check("session list", () => sessionList(client, scope));
  const [session] = await sessionList(client, { ...scope, limit: 1 });
  if (session) {
    await check("session events", () =>
      sessionEvents(client, { sessionId: session.session_id, projectIds: PROJECTS }),
    );
  }
  await check("closed sessions", () =>
    closedSessions(client, {
      projectIds: PROJECTS,
      idleSince: now - 30 * 60_000,
      notBefore: now - 2 * 86_400_000,
    }),
  );

  console.log("\npeople");
  await check("person list", () => personList(client, scope));
  const [person] = await personList(client, { ...scope, limit: 1 });
  if (person) {
    const opts = { personId: person.person_id, projectIds: PROJECTS };
    await check("person timeline", () => personTimeline(client, opts));
    await check("person projects", () => personProjects(client, opts));
    await check("acquisition chain", () => acquisitionChain(client, opts));
    await check("person interests", () => personInterests(client, opts));
  }

  console.log("\nlive & portfolio");
  await check("live visitors", () => liveVisitors(client, { projectIds: PROJECTS }));
  await check("live counts", () => liveCounts(client, { projectIds: PROJECTS }));
  await check("live feed", () =>
    liveFeed(client, { projectIds: PROJECTS, since: now - 30 * 86_400_000 }),
  );
  await check("portfolio overview", () => portfolioOverview(client, { projectIds: PROJECTS, range }));
  await check("portfolio sparklines", () =>
    portfolioSparklines(client, { projectIds: PROJECTS, range }),
  );
  await check("cross-project people", () => crossProjectPeople(client, { projectIds: PROJECTS, range }));

  await client.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

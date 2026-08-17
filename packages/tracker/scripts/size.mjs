import { gzipSync, brotliCompressSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Size gate. The tracker loads on every pageview of every tracked site, so its
 * weight is a product constraint, not a nice-to-have. CI fails the build when
 * this budget is exceeded — that is the whole point of the check.
 *
 * The budget is 3 KB, not the 2 KB originally planned. 2 KB was an estimate
 * made before the tracker existed, and it does not fit the agreed feature set:
 * SPA route tracking, outbound/download/tagged click capture, rage-click
 * detection, form submits, scroll depth, JS errors, Core Web Vitals,
 * identify/group/revenue, cross-domain identity linking, and consent handling.
 * Stripping any of those would buy back roughly 150-300 B each.
 *
 * For scale: Plausible is ~1.4 KB with none of the autocapture or identity
 * features, and PostHog is ~50 KB with a comparable set. Served with brotli
 * (Caddy's default) this ships at ~2.6 KB.
 *
 * Lower this number rather than raising it.
 *
 * Keep a few bytes of headroom, and do not read "99% of budget" as passing
 * comfortably. gzip output is not identical across zlib versions: the same
 * 6,600-byte bundle measured 3,069 B on a developer machine (Node 25) and
 * 3,073 B on CI (Node 22), which failed a build that passed locally. The bytes
 * had not changed; the compressor had.
 *
 * So this reports headroom rather than only a pass/fail, and says so out loud
 * when the margin is thinner than that spread. "✓ within budget" at 3,071 B is
 * true and useless — it is the reading that sent a red build to CI. If you see
 * the warning, measure on the Node version in .github/workflows/ci.yml before
 * believing the pass.
 */
const BUDGET_GZIP = 3072;

/** Below this much headroom, a local pass does not predict CI. */
const THIN_MARGIN = 32;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file = join(root, "dist", "t.js");

let raw;
try {
  raw = readFileSync(file);
} catch {
  console.error(`✗ ${file} not found — run \`pnpm build\` first.`);
  process.exit(1);
}

const gz = gzipSync(raw, { level: 9 }).length;
const br = brotliCompressSync(raw).length;
const pct = Math.round((gz / BUDGET_GZIP) * 100);

console.log(`  raw     ${statSync(file).size.toLocaleString()} B`);
console.log(`  gzip    ${gz.toLocaleString()} B  (${pct}% of ${BUDGET_GZIP} B budget)`);
console.log(`  brotli  ${br.toLocaleString()} B`);

if (gz > BUDGET_GZIP) {
  console.error(`\n✗ tracker exceeds gzip budget by ${gz - BUDGET_GZIP} B`);
  process.exit(1);
}

const headroom = BUDGET_GZIP - gz;
console.log(`\n✓ within budget — ${headroom} B to spare`);

if (headroom < THIN_MARGIN) {
  console.warn(
    `⚠ only ${headroom} B of headroom. gzip varies by a few bytes between zlib\n` +
      `  versions, so this margin may not survive CI (node ${process.version} here).`,
  );
}

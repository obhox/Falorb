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
 */
const BUDGET_GZIP = 3072;

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
console.log("\n✓ within budget");

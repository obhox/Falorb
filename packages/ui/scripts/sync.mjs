#!/usr/bin/env node
/**
 * Re-copy the design system into `packages/ui`, re-applying the deltas the app
 * needs.
 *
 * `Design System/` is the source of truth and is regenerated wholesale by the
 * design tool. `packages/ui` is that source plus a handful of corrections
 * without which the components are broken under SSR. Copying by hand loses
 * those corrections silently — the app still builds, and the failures show up
 * as hydration warnings and invisible icons.
 *
 * Every delta below is expressed as an assertion plus a transform, so this is
 * also a checker: `--check` reports drift without writing, which is what CI
 * should run.
 *
 * Usage:
 *   node scripts/sync.mjs           copy and transform
 *   node scripts/sync.mjs --check   exit non-zero if the copy is out of date
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");
const source = join(repoRoot, "Design System");
const target = join(packageRoot, "src");

const check = process.argv.includes("--check");

/**
 * The deltas, in the order they are applied.
 *
 * Each has a `test` naming the file it applies to and an `apply` doing the
 * rewrite. `required: true` means the transform must actually change something
 * — if a delta silently stops matching because upstream refactored the code,
 * that is drift worth failing on rather than a no-op to ignore.
 */
const DELTAS = [
  {
    name: '"use client" on every component',
    test: (path) => path.startsWith("components/") && path.endsWith(".jsx"),
    required: true,
    apply: (text) =>
      text.startsWith('"use client"') ? text : `"use client";\n\n${text}`,
  },
  {
    name: "Icon resolves from bundled lucide-react, not the CDN sprite",
    test: (path) => path === "components/core/Icon.jsx",
    required: true,
    // Replaced wholesale rather than patched: the CDN version is an effect that
    // mutates innerHTML, and there is no small edit that turns it into a
    // server-renderable component.
    apply: () => readFileSync(join(here, "overrides/Icon.jsx"), "utf8"),
  },
  {
    name: "Icon props contract documents the bundled set",
    test: (path) => path === "components/core/Icon.d.ts",
    required: true,
    apply: () => readFileSync(join(here, "overrides/Icon.d.ts"), "utf8"),
  },
  {
    name: "SVG gradient ids from useId, not Math.random",
    test: (path) =>
      path === "components/data/Sparkline.jsx" || path === "components/charts/LineChart.jsx",
    required: true,
    apply: (text) =>
      text.replace(
        /const (\w+) = React\.useMemo\(\(\) => "(\w+)" \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 8\), \[\]\);/,
        (_, variable, prefix) =>
          `// Stable across server and client render: a random id differs between\n` +
          `  // the two passes and breaks hydration on the url(#…) reference.\n` +
          `  const ${variable} = "${prefix}" + React.useId().replace(/:/g, "");`,
      ),
  },
  {
    name: "React 19 types: JSX.Element -> React.JSX.Element",
    test: (path) => path.endsWith(".d.ts"),
    required: false,
    apply: (text) => text.replace(/: JSX\.Element/g, ": React.JSX.Element"),
  },
  {
    name: "Checkbox and Switch carry a real input",
    test: (path) =>
      path === "components/forms/Checkbox.jsx" || path === "components/forms/Switch.jsx",
    required: true,
    apply: (_text, path) =>
      readFileSync(join(here, "overrides", path.split("/").pop()), "utf8"),
  },
  {
    name: "fonts.css defers to next/font",
    test: (path) => path === "tokens/fonts.css",
    required: true,
    apply: () => readFileSync(join(here, "overrides/fonts.css"), "utf8"),
  },
  {
    /**
     * Every one of these components is a control someone puts inside a form —
     * a Tabs strip above a fieldset, a SegmentedControl choosing an option, an
     * IconButton clearing a field, a Tag's remove "×". The design system emits
     * them as bare `<button>`, and a `<button>` with no `type` inside a
     * `<form>` defaults to `type="submit"`: clicking any of them submitted the
     * form instead of doing what it looked like it did. That is not a styling
     * difference, it is the control being wired to the wrong action.
     *
     * `Select` already carries `type="button"` upstream, which is what makes
     * this an oversight in the others rather than a house convention.
     *
     * Inserted immediately after the opening tag so anything spread later can
     * still override it — a caller who genuinely wants a submit button says so.
     */
    name: "Buttons inside forms do not submit them",
    test: (path) =>
      path === "components/core/IconButton.jsx" ||
      path === "components/core/Tag.jsx" ||
      path === "components/navigation/SegmentedControl.jsx" ||
      path === "components/navigation/Tabs.jsx",
    required: true,
    apply: (text) => text.replace(/<button\n(\s+)/g, '<button\n$1type="button"\n$1'),
  },
];

const COPY = [
  { from: "tokens", to: "tokens", ext: [".css"] },
  { from: "components", to: "components", ext: [".jsx", ".d.ts"] },
];

function walk(dir, ext, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, ext, base);
    return ext.some((e) => entry.endsWith(e)) ? [relative(base, full)] : [];
  });
}

const drift = [];
let copied = 0;

for (const group of COPY) {
  for (const file of walk(join(source, group.from), group.ext)) {
    const rel = `${group.to}/${file}`.replace(/\\/g, "/");
    const from = join(source, group.from, file);
    const to = join(target, group.to, file);

    let text = readFileSync(from, "utf8");

    for (const delta of DELTAS) {
      if (!delta.test(rel)) continue;
      const next = delta.apply(text, rel);
      if (delta.required && next === text) {
        drift.push(`${rel}: delta "${delta.name}" no longer applies — upstream changed shape`);
      }
      text = next;
    }

    const existing = existsSync(to) ? readFileSync(to, "utf8") : null;
    if (existing === text) continue;

    if (check) {
      drift.push(`${rel}: out of date`);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, text);
      copied++;
    }
  }
}

if (drift.length) {
  console.error("Design system copy is out of date:\n");
  for (const line of drift) console.error(`  ${line}`);
  console.error(`\nRun \`pnpm --filter @falorb/ui sync\` and review the result.`);
  process.exit(1);
}

console.log(
  check
    ? "packages/ui matches Design System/ with all deltas applied."
    : `Synced ${copied} file${copied === 1 ? "" : "s"} from Design System/.`,
);

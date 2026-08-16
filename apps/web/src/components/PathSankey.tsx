"use client";

import { SankeyDiagram } from "@falorb/ui";
import { compact, prettyPath } from "@/lib/format";

/**
 * Page-to-page transitions as a two-column Sankey.
 *
 * `path_transitions` is a flat from/to table with no notion of depth, so this
 * renders one hop: sources on the left, destinations on the right. Rendering
 * it as a multi-level flow would imply an ordering the data does not contain —
 * A→B and B→C are separate rows, and chaining them would invent journeys
 * nobody took.
 *
 * The graph is capped at the top edges by volume. A Sankey with sixty nodes is
 * a hairball, and the tail is where the noise lives.
 */

const MAX_NODES_PER_SIDE = 10;

export function PathSankey({
  transitions,
}: {
  transitions: { from: string; to: string; value: number }[];
}) {
  const topSources = topBy(transitions, (t) => t.from);
  const topTargets = topBy(transitions, (t) => t.to);

  const links = transitions
    .filter((t) => topSources.has(t.from) && topTargets.has(t.to))
    .sort((a, b) => b.value - a.value)
    .slice(0, 40)
    .map((t) => ({ from: `s:${t.from}`, to: `t:${t.to}`, value: t.value }));

  const usedSources = new Set(links.map((l) => l.from));
  const usedTargets = new Set(links.map((l) => l.to));

  const nodes = [
    ...[...topSources]
      .filter((path) => usedSources.has(`s:${path}`))
      .map((path) => ({ id: `s:${path}`, label: prettyPath(path, 28), column: 0 })),
    ...[...topTargets]
      .filter((path) => usedTargets.has(`t:${path}`))
      .map((path) => ({ id: `t:${path}`, label: prettyPath(path, 28), column: 1 })),
  ];

  return <SankeyDiagram nodes={nodes} links={links} height={320} format={compact} />;
}

function topBy(
  transitions: { from: string; to: string; value: number }[],
  key: (t: { from: string; to: string; value: number }) => string,
): Set<string> {
  const totals = new Map<string, number>();
  for (const transition of transitions) {
    const k = key(transition);
    totals.set(k, (totals.get(k) ?? 0) + transition.value);
  }
  return new Set(
    [...totals.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_NODES_PER_SIDE)
      .map(([path]) => path),
  );
}

"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@falorb/ui";
import { RANGE_PRESETS, rangeHref, resolveRange, type RangePresetKey } from "@/lib/range";

/**
 * The date range control.
 *
 * Reads the current range from the URL rather than taking it as a prop.
 * Layouts do not receive `searchParams` in the App Router, and this control
 * lives in the project layout's header — so the URL is the only place both the
 * layout and the pages beneath it can agree on.
 *
 * Writing to the URL rather than to component state means the range survives a
 * reload, can be shared, and is readable by the server components that
 * actually run the queries. The transition keeps the previous figures on
 * screen while the new ones are fetched instead of blanking the panel.
 */
export function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  // Only the preset key matters here; the resolved window is recomputed
  // server-side, so no clock is read during render.
  const current = resolveRange({
    range: params.get("range") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  }).key;

  const labels = RANGE_PRESETS.map((preset) => preset.label);
  const currentLabel =
    RANGE_PRESETS.find((preset) => preset.key === current)?.label ?? RANGE_PRESETS[2]!.label;

  return (
    <SegmentedControl
      size="sm"
      options={labels}
      value={currentLabel}
      onChange={(label: string) => {
        const preset = RANGE_PRESETS.find((p) => p.label === label);
        if (!preset) return;
        const href = rangeHref(pathname, params, preset.key as RangePresetKey);
        startTransition(() => router.push(href, { scroll: false }));
      }}
    />
  );
}

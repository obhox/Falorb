"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@falorb/ui";

/**
 * Cohort granularity, written to `?by=`.
 *
 * Separate from the range picker because the two are genuinely independent:
 * weekly cohorts over ninety days and weekly cohorts over a year are both
 * sensible, and coupling them would remove a choice the reader needs.
 */
export function GranularityPicker({
  current,
  options,
  param = "by",
  labels: overrides,
}: {
  current: string;
  options: string[];
  param?: string;
  /** Display text per option. Without it the option itself is capitalised,
   *  which is wrong for snake_case values like `first_touch`. */
  labels?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const label = (option: string) => overrides?.[option] ?? capitalize(option);

  return (
    <SegmentedControl
      size="sm"
      options={options.map(label)}
      value={label(current)}
      onChange={(chosen: string) => {
        const value = options.find((option) => label(option) === chosen);
        if (!value) return;
        const next = new URLSearchParams(params.toString());
        next.set(param, value);
        startTransition(() =>
          router.replace(`${pathname}?${next.toString()}`, { scroll: false }),
        );
      }}
    />
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

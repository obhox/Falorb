"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Checkbox, Icon, Input, Select } from "@falorb/ui";

const SORT_LABELS = {
  recent: "Last seen",
  lead_score: "Lead score",
  events: "Events",
} as const;

type SortKey = keyof typeof SORT_LABELS;

/**
 * The people filter bar.
 *
 * Filters live in the URL so a filtered list can be shared and reloaded, and
 * so the server does the filtering — the table shows the first page of a large
 * set, and filtering only what the client happens to be holding would silently
 * search one page instead of the whole set.
 *
 * The search box is debounced: without it, every keystroke is a server round
 * trip and a Postgres ILIKE.
 */
export function PeopleFilters({
  search,
  identifiedOnly,
  sort,
  total,
}: {
  search: string;
  identifiedOnly: boolean;
  sort: SortKey;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [term, setTerm] = useState(search);

  function push(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    // Any filter change invalidates the current page.
    next.delete("page");
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  // Debounce the search term. The cleanup cancels the pending push whenever
  // another character arrives, so only the last value in a burst is sent.
  useEffect(() => {
    if (term === search) return;
    const timer = setTimeout(() => {
      push((next) => {
        if (term.trim()) next.set("q", term.trim());
        else next.delete("q");
      });
    }, 280);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 0 var(--space-6)",
        flexWrap: "wrap",
      }}
    >
      <Input
        size="sm"
        value={term}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
        placeholder="Search email, name or id"
        iconLeft={<Icon name="search" size={13} />}
        style={{ minWidth: 260 }}
      />

      <Checkbox
        checked={identifiedOnly}
        onChange={(checked: boolean) =>
          push((next) => {
            if (checked) next.set("identified", "1");
            else next.delete("identified");
          })
        }
        label="Identified only"
      />

      <Select
        size="sm"
        value={SORT_LABELS[sort]}
        options={Object.values(SORT_LABELS)}
        onChange={(label: string) => {
          const entry = Object.entries(SORT_LABELS).find(([, l]) => l === label);
          if (!entry) return;
          push((next) => {
            if (entry[0] === "recent") next.delete("sort");
            else next.set("sort", entry[0]);
          });
        }}
      />

      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--size-micro)",
          color: "var(--text-muted)",
        }}
      >
        {total.toLocaleString("en-US")} {total === 1 ? "person" : "people"}
      </span>
    </div>
  );
}

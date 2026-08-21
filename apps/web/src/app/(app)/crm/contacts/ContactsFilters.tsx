"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon, Input, Select } from "@falorb/ui";

const FILTER_LABELS = {
  all: "All contacts",
  unmatched: "Not yet in CRM",
} as const;

type FilterKey = keyof typeof FILTER_LABELS;

/**
 * Filter bar for the full Linki contacts mirror — same URL-driven,
 * debounced-search shape as `PeopleFilters`, scoped to what this list
 * actually supports (no lead score or identified-only here, this isn't the
 * analytics people list).
 */
export function ContactsFilters({
  search,
  filter,
  total,
}: {
  search: string;
  filter: FilterKey;
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
    next.delete("page");
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

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
        placeholder="Search name, email or company"
        iconLeft={<Icon name="search" size={13} />}
        style={{ minWidth: 260 }}
      />

      <Select
        size="sm"
        value={FILTER_LABELS[filter]}
        options={Object.values(FILTER_LABELS)}
        onChange={(label: string) => {
          const entry = Object.entries(FILTER_LABELS).find(([, l]) => l === label);
          if (!entry) return;
          push((next) => {
            if (entry[0] === "all") next.delete("filter");
            else next.set("filter", entry[0]);
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
        {total.toLocaleString("en-US")} {total === 1 ? "contact" : "contacts"}
      </span>
    </div>
  );
}

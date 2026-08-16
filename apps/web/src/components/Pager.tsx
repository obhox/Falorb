"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button, Icon } from "@falorb/ui";

/**
 * Offset pagination.
 *
 * The page number lives in the URL, so a deep page survives a reload and can
 * be linked. `hasMore` comes from the query fetching one row past the page
 * rather than from arithmetic on a total, which stays correct even when rows
 * are inserted between two page loads.
 */
export function Pager({
  page,
  hasMore,
  total,
  pageSize,
}: {
  page: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (page === 1 && !hasMore) return null;

  function go(to: number) {
    const next = new URLSearchParams(params.toString());
    if (to <= 1) next.delete("page");
    else next.set("page", String(to));
    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        paddingTop: "var(--space-2)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--size-micro)",
          color: "var(--text-muted)",
        }}
      >
        {first.toLocaleString("en-US")}–{last.toLocaleString("en-US")} of{" "}
        {total.toLocaleString("en-US")}
      </span>

      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <Button
          size="sm"
          disabled={page <= 1 || pending}
          onClick={() => go(page - 1)}
          iconLeft={<Icon name="chevron-left" size={13} />}
        >
          Previous
        </Button>
        <Button
          size="sm"
          disabled={!hasMore || pending}
          onClick={() => go(page + 1)}
          iconRight={<Icon name="chevron-right" size={13} />}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

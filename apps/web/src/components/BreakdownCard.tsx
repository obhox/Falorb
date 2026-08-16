import Link from "next/link";
import { Card, MetricBar } from "@falorb/ui";
import { Empty } from "@/components/Empty";

/**
 * A ranked dimension list — top pages, sources, countries, browsers.
 *
 * Shares are computed against the largest row rather than the total, so the
 * leader's bar always fills the track. A share-of-total scale leaves every bar
 * a stub whenever the distribution has a long tail, which is the normal shape
 * of this data and makes the panel unreadable.
 */

export interface BreakdownItem {
  label: string;
  value: string;
  count: number;
  meta?: string;
  href?: string;
}

export function BreakdownCard({
  title,
  subtitle,
  items,
  emptyBody,
  action,
}: {
  title: string;
  subtitle?: string;
  items: BreakdownItem[];
  emptyBody: string;
  action?: React.ReactNode;
}) {
  const top = Math.max(...items.map((item) => item.count), 1);

  return (
    <Card title={title} subtitle={subtitle} action={action}>
      {items.length === 0 ? (
        <Empty dense icon="inbox" title="Nothing recorded" body={emptyBody} />
      ) : (
        <div style={{ display: "grid", gap: 1 }}>
          {items.map((item) => {
            const bar = (
              <MetricBar
                label={item.label}
                value={item.value}
                meta={item.meta}
                share={(item.count / top) * 100}
              />
            );
            return item.href ? (
              <Link
                key={item.label}
                href={item.href}
                data-plain
                style={{ textDecoration: "none", display: "block" }}
              >
                {bar}
              </Link>
            ) : (
              <div key={item.label}>{bar}</div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

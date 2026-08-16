"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The per-property tab strip.
 *
 * Same underline treatment as the design system's `Tabs`, rebuilt on links so
 * each tab is a real URL. The current search string is carried across, so
 * switching from Summary to Paths keeps the selected date range instead of
 * silently resetting it to the default.
 */

export interface ProjectTab {
  href: string;
  label: string;
}

export function ProjectTabs({ tabs }: { tabs: ProjectTab[] }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const query = search ? `?${search}` : "";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 22,
        padding: "0 var(--pad-panel)",
        borderBottom: "1px solid var(--border-subtle)",
        flex: "0 0 auto",
      }}
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${query}`}
            aria-current={active ? "page" : undefined}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "11px 0 12px",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: "var(--size-body-sm)",
              fontWeight: active ? "var(--wt-semibold)" : "var(--wt-medium)",
              letterSpacing: "var(--ls-body)",
              textDecoration: "none",
              transition: "color var(--dur-1) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = "var(--text-body)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            {tab.label}
            <span
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: -1,
                height: 1.5,
                background: active ? "var(--ink-50)" : "transparent",
                transition: "background var(--dur-3) var(--ease-out)",
              }}
            />
          </Link>
        );
      })}
    </div>
  );
}

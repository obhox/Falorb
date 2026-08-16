"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@falorb/ui";

/**
 * The 224px left rail.
 *
 * The design system's `SidebarNav` drives selection through an `onChange`
 * callback, which suits a prototype but means every navigation is a client
 * state change. Here each row is a real `<Link>`: the URL is the state, so a
 * row can be opened in a new tab, deep-linked and prefetched. The visual spec —
 * 32px rows, glacier selection tint, hairline selected border, trailing mono
 * figure — is unchanged.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  meta?: string;
  /** Match nested routes too, e.g. /p/site highlights on /p/site/people. */
  prefix?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export function NavRail({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", flex: 1 }}>
      {sections.map((section, index) => (
        <div key={section.label ?? index} style={{ display: "grid", gap: 2 }}>
          {section.label && (
            <div
              style={{
                padding: "0 10px 6px",
                fontSize: "var(--size-micro)",
                textTransform: "uppercase",
                letterSpacing: "var(--ls-label)",
                color: "var(--text-muted)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              {section.label}
            </div>
          )}
          {section.items.map((item) => (
            <NavRow key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        height: 32,
        padding: "0 10px",
        borderRadius: "var(--radius-3)",
        border: `1px solid ${active ? "rgba(125,211,252,.16)" : "transparent"}`,
        background: active ? "var(--surface-selected)" : "transparent",
        color: active ? "var(--glacier-100)" : "var(--text-secondary)",
        fontSize: "var(--size-body-sm)",
        fontWeight: active ? "var(--wt-medium)" : "var(--wt-regular)",
        textDecoration: "none",
        transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.background = "var(--surface-hover)";
        e.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
    >
      <Icon name={item.icon} size={15} />
      <span
        style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {item.label}
      </span>
      {item.meta !== undefined && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontFeatureSettings: "var(--tnum)",
            fontSize: "var(--size-micro)",
            color: "var(--text-muted)",
          }}
        >
          {item.meta}
        </span>
      )}
    </Link>
  );
}

/**
 * Exact match by default.
 *
 * `prefix` exists for the property rows, which must stay lit while the reader
 * is inside any of that property's tabs. It deliberately checks for a following
 * `/` so that `/p/falorb` does not also light up `/p/falorb-docs`.
 */
function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  return Boolean(item.prefix) && pathname.startsWith(`${item.href}/`);
}

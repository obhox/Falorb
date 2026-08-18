"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@falorb/ui";

/**
 * The hamburger + slide-in drawer that stands in for the 224px rail below
 * 1024px. `children` is the server-rendered `<ShellNav>` — identical content
 * to the desktop rail, just mounted here instead so the same markup never
 * has to be duplicated by hand.
 *
 * The bar itself is CSS-only hidden at desktop widths (`.falorb-mobile-nav-bar`
 * in responsive.css); this component only owns the open/closed state.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A navigation is the reader's answer to "take me there" — the drawer
  // should get out of the way rather than sit open over the new page.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="falorb-mobile-nav-bar">
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            padding: 0,
            borderRadius: "var(--radius-2)",
            border: "1px solid var(--border-subtle)",
            background: "transparent",
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          <Icon name={open ? "x" : "menu"} size={17} />
        </button>
        <span
          style={{
            fontSize: "var(--size-body-sm)",
            fontWeight: "var(--wt-semibold)",
            color: "var(--text-primary)",
          }}
        >
          Falorb
        </span>
      </div>

      {open && (
        <>
          <div
            className="falorb-mobile-nav-scrim"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="falorb-mobile-nav-drawer" role="dialog" aria-modal="true">
            {children}
          </div>
        </>
      )}
    </>
  );
}

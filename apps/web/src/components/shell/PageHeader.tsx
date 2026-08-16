import type { ReactNode } from "react";

/**
 * The 52px page header: title and meta on the left, controls on the right.
 *
 * Fixed height and a hairline bottom border, so tabs can sit directly beneath
 * it without a gap — the design system's layout rule for every screen.
 */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        height: 52,
        padding: "0 var(--pad-panel)",
        borderBottom: "1px solid var(--border-subtle)",
        flex: "0 0 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: "var(--wt-semibold)",
            letterSpacing: "-.022em",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </h1>
        {meta && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {meta}
          </span>
        )}
      </div>
      {actions && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {actions}
        </div>
      )}
    </header>
  );
}

/** The scrolling body under a header. Panels never touch the panel edge. */
export function PageBody({
  children,
  padded = true,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <div
      className="falorb-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        padding: padded ? "var(--pad-panel)" : 0,
      }}
    >
      <div style={{ maxWidth: "var(--content-max)", display: "grid", gap: "var(--space-6)" }}>
        {children}
      </div>
    </div>
  );
}

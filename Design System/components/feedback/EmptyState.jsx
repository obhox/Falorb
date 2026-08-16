import React from "react";

export function EmptyState({ icon, title, body, action, dense = false, style }) {
  return (
    <div
      style={{
        display: "grid", justifyItems: "center", gap: 8,
        padding: dense ? "22px 16px" : "44px 24px",
        textAlign: "center", ...style
      }}
    >
      {icon && (
        <span
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, marginBottom: 2,
            borderRadius: "var(--radius-control)",
            background: "var(--w-4)", border: "1px solid var(--border-subtle)",
            color: "var(--text-muted)"
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ fontSize: "var(--size-body-sm)", fontWeight: "var(--wt-semibold)", color: "var(--text-primary)" }}>{title}</div>
      {body && (
        <p style={{ margin: 0, maxWidth: 320, fontSize: "var(--size-label)", color: "var(--text-muted)", lineHeight: "var(--lh-normal)" }}>{body}</p>
      )}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

import React from "react";

export function Checkbox({ checked = false, onChange, label, description, disabled = false, style }) {
  return (
    <label
      style={{
        display: "inline-flex", alignItems: description ? "flex-start" : "center", gap: 9,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, ...style
      }}
    >
      <span
        onClick={() => !disabled && onChange && onChange(!checked)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, flex: "0 0 auto", marginTop: description ? 1 : 0,
          borderRadius: "var(--radius-1)",
          background: checked ? "var(--glacier-400)" : "var(--surface-inset)",
          border: `1px solid ${checked ? "var(--glacier-400)" : "var(--control-border)"}`,
          boxShadow: "var(--edge-top)",
          transition: "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out)"
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5.2l2 2L8 3" stroke="var(--ink-1000)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {(label || description) && (
        <span style={{ display: "grid", gap: 2 }}>
          {label && <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>{label}</span>}
          {description && <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{description}</span>}
        </span>
      )}
    </label>
  );
}

"use client";

import React from "react";

/**
 * The design system's checkbox drew the box as a `<span>` with an `onClick` and
 * no form control behind it. That looks right and behaves badly: clicking the
 * text label does nothing (only the box carries the handler), the control takes
 * no keyboard focus, space does not toggle it, and assistive technology sees a
 * decorative box rather than a checkbox.
 *
 * The fix is a visually-hidden native `<input type="checkbox">` inside the
 * label. The painted box is unchanged and now purely presentational; the input
 * supplies the semantics, the focus and the label association for free.
 */
export function Checkbox({ checked = false, onChange, label, description, disabled = false, style }) {
  const [focus, setFocus] = React.useState(false);

  return (
    <label
      style={{
        display: "inline-flex", alignItems: description ? "flex-start" : "center", gap: 9,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, ...style
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange && onChange(e.target.checked)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={HIDDEN_INPUT}
      />
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, flex: "0 0 auto", marginTop: description ? 1 : 0,
          borderRadius: "var(--radius-1)",
          background: checked ? "var(--glacier-400)" : "var(--surface-inset)",
          border: `1px solid ${checked ? "var(--glacier-400)" : "var(--control-border)"}`,
          boxShadow: focus ? "var(--focus-ring)" : "var(--edge-top)",
          transition: "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-2) var(--ease-out)"
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

/**
 * Hidden without being removed from the accessibility tree. `display:none` or
 * `visibility:hidden` would take the input out of the tab order and stop it
 * receiving focus, which is the whole point of having it.
 */
export const HIDDEN_INPUT = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0
};

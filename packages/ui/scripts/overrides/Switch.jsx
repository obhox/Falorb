"use client";

import React from "react";
import { HIDDEN_INPUT } from "./Checkbox.jsx";

/**
 * Same correction as `Checkbox`: the original painted the track and knob as
 * spans with an `onClick` and no control behind them, so the switch could not
 * be reached by keyboard, could not be toggled with space, was not announced as
 * a switch, and ignored clicks on its own text label.
 *
 * A visually-hidden `<input type="checkbox" role="switch">` supplies all of
 * that. The painted track is unchanged and marked decorative.
 */
export function Switch({ checked = false, onChange, label, size = "md", disabled = false, style }) {
  const [focus, setFocus] = React.useState(false);
  const w = size === "sm" ? 28 : 34;
  const h = size === "sm" ? 16 : 20;
  const k = h - 6;

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 9, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, ...style }}>
      <input
        type="checkbox"
        role="switch"
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
          position: "relative", display: "inline-block", width: w, height: h, flex: "0 0 auto",
          borderRadius: "var(--radius-pill)",
          background: checked ? "var(--glacier-400)" : "var(--w-8)",
          border: `1px solid ${checked ? "var(--glacier-400)" : "var(--control-border)"}`,
          boxShadow: focus ? "var(--focus-ring)" : "var(--edge-top)",
          transition: "background var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out)"
        }}
      >
        <span
          style={{
            position: "absolute", top: 2, left: checked ? w - k - 4 : 2,
            width: k, height: k, borderRadius: 999,
            background: checked ? "var(--ink-1000)" : "var(--ink-200)",
            transition: "left var(--dur-2) var(--ease-emphasis), background var(--dur-2) var(--ease-out)"
          }}
        />
      </span>
      {label && <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>{label}</span>}
    </label>
  );
}

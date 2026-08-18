"use client";

import React from "react";

export function Input({
  value,
  onChange,
  placeholder,
  label,
  hint,
  iconLeft,
  suffix,
  size = "md",
  mono = false,
  invalid = false,
  disabled = false,
  style,
  inputStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "sm" ? 28 : size === "lg" ? 42 : 34;
  return (
    <label style={{ display: "grid", gap: 6, minWidth: 0, ...style }}>
      {label && (
        <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
          {label}
        </span>
      )}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: h,
          minWidth: 0,
          padding: "0 10px",
          borderRadius: "var(--radius-control)",
          background: "var(--surface-inset)",
          border: `1px solid ${invalid ? "rgba(242,116,139,.5)" : focus ? "rgba(125,211,252,.45)" : "var(--control-border)"}`,
          boxShadow: focus ? "var(--focus-ring)" : "var(--edge-top)",
          opacity: disabled ? 0.45 : 1,
          transition: "border-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out)"
        }}
      >
        {iconLeft && <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{iconLeft}</span>}
        <input
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-primary)",
            fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
            fontFeatureSettings: mono ? "var(--tnum)" : undefined,
            fontSize: size === "sm" ? "var(--size-label)" : "var(--size-body-sm)",
            letterSpacing: "var(--ls-body)",
            ...inputStyle
          }}
          {...rest}
        />
        {suffix && (
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {suffix}
          </span>
        )}
      </span>
      {hint && (
        <span style={{ fontSize: "var(--size-micro)", color: invalid ? "var(--signal-down)" : "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

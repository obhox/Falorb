"use client";

import React from "react";

export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  active = false,
  disabled = false,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const dim = size === "sm" ? 28 : size === "lg" ? 40 : 34;
  const bg =
    variant === "glass" ? "var(--glass-bg)" :
    variant === "solid" ? "var(--control-bg)" : "transparent";
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim,
        height: dim,
        borderRadius: "var(--radius-control)",
        border: variant === "ghost" ? "1px solid transparent" : "1px solid var(--control-border)",
        background: active ? "var(--surface-active)" : hover && !disabled ? "var(--surface-hover)" : bg,
        color: active ? "var(--text-primary)" : hover ? "var(--text-primary)" : "var(--text-secondary)",
        backdropFilter: variant === "glass" ? "var(--glass-blur)" : undefined,
        WebkitBackdropFilter: variant === "glass" ? "var(--glass-blur)" : undefined,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.38 : 1,
        transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)",
        ...style
      }}
      {...rest}
    >
      {icon}
    </button>
  );
}

import React from "react";

const SIZES = {
  sm: { height: 28, padX: 10, font: "var(--size-label)", gap: 6, radius: "var(--radius-3)" },
  md: { height: 34, padX: 12, font: "var(--size-body-sm)", gap: 7, radius: "var(--radius-control)" },
  lg: { height: 42, padX: 18, font: "var(--size-body)", gap: 8, radius: "var(--radius-control)" }
};

const VARIANTS = {
  primary: {
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-fg)",
    border: "1px solid transparent",
    boxShadow: "var(--shadow-2)",
    hover: { background: "var(--btn-primary-bg-hover)" }
  },
  secondary: {
    background: "var(--control-bg)",
    color: "var(--control-fg)",
    border: "1px solid var(--control-border)",
    boxShadow: "var(--edge-top)",
    hover: { background: "var(--control-bg-hover)" }
  },
  glass: {
    background: "var(--glass-bg)",
    color: "var(--text-primary)",
    border: "var(--glass-border)",
    backdropFilter: "var(--glass-blur)",
    WebkitBackdropFilter: "var(--glass-blur)",
    boxShadow: "var(--edge-top)",
    hover: { background: "var(--w-12)" }
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid transparent",
    hover: { background: "var(--surface-hover)", color: "var(--text-primary)" }
  },
  accent: {
    background: "var(--glacier-400)",
    color: "var(--ink-1000)",
    border: "1px solid transparent",
    boxShadow: "var(--shadow-2)",
    hover: { background: "var(--glacier-300)" }
  },
  danger: {
    background: "var(--signal-down-dim)",
    color: "var(--signal-down)",
    border: "1px solid rgba(242,116,139,.28)",
    hover: { background: "rgba(242,116,139,.18)" }
  }
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  disabled = false,
  fullWidth = false,
  as = "button",
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const { hover: hoverStyle, ...base } = v;
  const Tag = as;
  return (
    <Tag
      disabled={Tag === "button" ? disabled : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: s.height,
        padding: `0 ${s.padX}px`,
        borderRadius: s.radius,
        fontFamily: "var(--font-sans)",
        fontSize: s.font,
        fontWeight: "var(--wt-medium)",
        letterSpacing: "var(--ls-body)",
        lineHeight: 1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.38 : 1,
        whiteSpace: "nowrap",
        transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out)",
        transform: press && !disabled ? "translateY(0.5px) scale(0.994)" : "none",
        ...base,
        ...(hover && !disabled ? hoverStyle : null),
        ...style
      }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </Tag>
  );
}

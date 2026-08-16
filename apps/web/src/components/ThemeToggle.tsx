"use client";

import { useOptimistic, useTransition } from "react";
import { Icon } from "@falorb/ui";
import { setTheme } from "@/server/actions/theme";
import type { ThemeChoice } from "@/server/theme";

const OPTIONS: { value: ThemeChoice; icon: string; label: string }[] = [
  { value: "light", icon: "sun", label: "Light" },
  { value: "dark", icon: "moon", label: "Dark" },
  { value: "system", icon: "monitor", label: "Match system" },
];

/**
 * Three-way theme switch.
 *
 * "System" is a real option rather than an implicit default, because without it
 * anyone who picks light or dark once can never get back to following their
 * machine — a one-way door that shows up as "why is the app light at night".
 *
 * The selection updates optimistically. The server action rewrites a cookie and
 * revalidates the root layout, which takes a beat; without the optimistic value
 * the button you just pressed stays unlit for that beat and reads as broken.
 */
export function ThemeToggle({ current }: { current: ThemeChoice }) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(current);

  return (
    <div
      role="group"
      aria-label="Theme"
      style={{
        display: "inline-grid",
        gridAutoFlow: "column",
        gap: 2,
        padding: 2,
        borderRadius: "var(--radius-control)",
        background: "var(--surface-inset)",
        border: "1px solid var(--control-border)",
      }}
    >
      {OPTIONS.map((option) => {
        const active = optimistic === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            onClick={() =>
              startTransition(() => {
                setOptimistic(option.value);
                void setTheme(option.value);
              })
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 22,
              padding: 0,
              borderRadius: "var(--radius-2)",
              border: "1px solid transparent",
              background: active ? "var(--surface-active)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer",
              transition:
                "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)",
            }}
          >
            <Icon name={option.icon} size={13} />
          </button>
        );
      })}
    </div>
  );
}

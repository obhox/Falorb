"use client";

import { useEffect, useState } from "react";
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
 * The pressed option lights immediately. The server action rewrites a cookie
 * and revalidates the root layout, which takes a beat; without local state the
 * button you just pressed stays unlit for that beat and reads as broken.
 *
 * Local state rather than `useOptimistic`, deliberately. An optimistic update
 * has to happen inside a transition that is still open, and a `startTransition`
 * with a synchronous body closes its scope the moment that body returns — the
 * async action it kicked off is still in flight. React 19 raises "an optimistic
 * state update occurred outside a transition or action" for that, and because
 * this control sits in the app shell the error surfaced on *other* screens,
 * where it looked like the alert or goal action had failed. Plain state gives
 * the same instant feedback with none of that coupling.
 */
export function ThemeToggle({ current }: { current: ThemeChoice }) {
  const [selected, setSelected] = useState<ThemeChoice>(current);

  // The cookie is the source of truth. Re-syncing when the server sends a new
  // value keeps this honest if the theme changed in another tab.
  useEffect(() => setSelected(current), [current]);

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
        const active = selected === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            onClick={() => {
              setSelected(option.value);
              void setTheme(option.value);
            }}
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

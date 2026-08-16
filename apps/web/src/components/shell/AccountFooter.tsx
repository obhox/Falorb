"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@falorb/ui";
import { signOut } from "@/lib/auth-client";

/**
 * Sidebar footer: who is signed in, and where the instance runs.
 *
 * The design system kit showed an "Event storage 41.2 / 100 GB" meter here.
 * That figure has no source — nothing measures ClickHouse disk usage yet — and
 * the system's own rule is specific numbers or nothing, so the meter is left
 * out rather than filled with a plausible invention. The retention window is
 * shown instead, which is a real setting.
 */
export function AccountFooter({
  name,
  email,
  organization,
  meta,
}: {
  name: string | null;
  email: string;
  organization: string;
  meta: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hover, setHover] = useState(false);

  const display = name?.trim() || email;
  const initials = display
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  async function handleSignOut() {
    await signOut();
    startTransition(() => {
      router.refresh();
      router.replace("/sign-in");
    });
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        paddingTop: 12,
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            background: "var(--ink-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "var(--text-body)",
            fontWeight: "var(--wt-semibold)",
            flex: "0 0 auto",
          }}
        >
          {initials || "?"}
        </span>
        <span style={{ display: "grid", minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-body)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={email}
          >
            {display}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={organization}
          >
            {meta}
          </span>
        </span>
        <button
          onClick={handleSignOut}
          disabled={pending}
          aria-label="Sign out"
          title="Sign out"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            flex: "0 0 auto",
            borderRadius: "var(--radius-2)",
            border: "1px solid transparent",
            background: hover ? "var(--surface-hover)" : "transparent",
            color: hover ? "var(--text-primary)" : "var(--text-muted)",
            cursor: pending ? "not-allowed" : "pointer",
            transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)",
          }}
        >
          <Icon name="log-out" size={13} />
        </button>
      </div>
    </div>
  );
}

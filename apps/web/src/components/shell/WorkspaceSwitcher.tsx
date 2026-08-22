"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon } from "@falorb/ui";
import { switchWorkspace } from "@/server/actions/workspace";

export interface WorkspaceOption {
  organizationId: string;
  organizationName: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

/**
 * Which workspace you are looking at, and how to change it.
 *
 * Rendered only when there is a choice to make. A dropdown listing one item is
 * a control that does nothing, and it would appear for the overwhelming
 * majority of accounts, so a single-workspace user gets a plain label instead —
 * the name is still worth showing, because "whose data am I looking at" is the
 * question the rest of the screen depends on.
 *
 * The switch is a server action, not a client-side store: which workspace is
 * active decides what every query in the shell is scoped to, so it has to be
 * resolved server-side on the next render rather than held in the browser
 * where it could disagree with what the server believes.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: string;
  workspaces: WorkspaceOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [hover, setHover] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const active = workspaces.find((w) => w.organizationId === current);
  const label = active?.organizationName ?? "Workspace";

  // Dismiss on an outside press or Escape. Both are needed: pointer users
  // expect clicking away to close, keyboard users have no "away" to click.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        // Return focus to the trigger, or the tab order restarts from the top
        // of the document.
        containerRef.current?.querySelector("button")?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (workspaces.length < 2) {
    return (
      <div
        style={{
          padding: "0 10px 10px",
          fontSize: 11,
          color: "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={label}
      >
        {label}
      </div>
    );
  }

  function choose(organizationId: string) {
    if (organizationId === current) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await switchWorkspace(organizationId);
      setOpen(false);
    });
  }

  return (
    <div ref={containerRef} style={{ position: "relative", padding: "0 10px 10px" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 8px",
          borderRadius: "var(--radius-control)",
          border: "1px solid var(--control-border)",
          background: hover || open ? "var(--surface-hover)" : "var(--surface-inset)",
          color: "var(--text-body)",
          cursor: pending ? "wait" : "pointer",
          textAlign: "left",
          font: "inherit",
          fontSize: 12,
          transition: "background var(--dur-1) var(--ease-out)",
        }}
      >
        <Icon name="building-2" size={13} style={{ color: "var(--text-muted)" }} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={label}
        >
          {label}
        </span>
        <Icon
          name="chevrons-up-down"
          size={13}
          style={{ color: "var(--text-muted)" }}
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Switch workspace"
          style={{
            position: "absolute",
            top: "calc(100% - 4px)",
            left: 10,
            right: 10,
            zIndex: 20,
            display: "grid",
            gap: 1,
            padding: 4,
            maxHeight: 320,
            overflowY: "auto",
            borderRadius: "var(--radius-control)",
            border: "1px solid var(--border-subtle)",
            background: "var(--surface-raised, var(--surface-panel))",
            boxShadow: "var(--shadow-3)",
          }}
        >
          {workspaces.map((workspace, index) => {
            const isActive = workspace.organizationId === current;
            return (
              <button
                key={workspace.organizationId}
                type="button"
                role="menuitem"
                autoFocus={isActive || (index === 0 && !active)}
                disabled={pending}
                onClick={() => choose(workspace.organizationId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "var(--radius-2)",
                  border: "1px solid transparent",
                  background: isActive ? "var(--surface-active)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-body)",
                  cursor: pending ? "wait" : "pointer",
                  textAlign: "left",
                  font: "inherit",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "var(--surface-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ display: "grid", flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {workspace.organizationName}
                  </span>
                  {/* The role travels with the workspace, so showing it here
                      answers "why can't I change this setting" before it is
                      asked. */}
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {ROLE_LABEL[workspace.role] ?? workspace.role}
                  </span>
                </span>
                {isActive && (
                  <Icon name="check" size={13} style={{ color: "var(--text-muted)" }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

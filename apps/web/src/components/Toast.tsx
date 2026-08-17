"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@falorb/ui";

/**
 * Transient feedback for actions.
 *
 * Every mutation in this dashboard is a server action — a round trip that
 * writes to Postgres and often revalidates a route. Without feedback the
 * button looks idle for the whole of it, so people press it again, and a
 * failure is indistinguishable from a slow success. A toast is the smallest
 * thing that answers "did that work".
 *
 * Rendered through a portal on `document.body` for the same reason `Select`
 * is: `Card` clips to its corner radius and panel bodies scroll, so anything
 * positioned inside the tree gets cut off.
 *
 * Errors do not auto-dismiss. A success can be missed harmlessly — the screen
 * already shows the new state — but a failure that disappears before it is
 * read leaves someone believing a write landed when it did not.
 */

export type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 4_000;
/** Beyond this the oldest is dropped; a stack taller than this is noise. */
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      if (!message) return;
      const id = nextId.current++;

      setToasts((current) => {
        // Repeating an identical message tells the reader nothing new — a
        // double-click should not produce two toasts.
        const withoutDuplicate = current.filter(
          (toast) => !(toast.tone === tone && toast.message === message),
        );
        return [...withoutDuplicate, { id, tone, message }].slice(-MAX_VISIBLE);
      });

      if (tone !== "error") {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
        );
      }
    },
    [dismiss],
  );

  // Clearing on unmount matters: a navigation mid-timeout would otherwise fire
  // setState against a provider that no longer exists.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return api;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      // `polite` rather than `assertive`: these announce after the current
      // utterance instead of interrupting someone mid-sentence.
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        right: "var(--shell-pad)",
        bottom: "var(--shell-pad)",
        zIndex: 2000,
        display: "grid",
        gap: 8,
        justifyItems: "end",
        // The container spans the corner but must not swallow clicks on the
        // page behind it; individual toasts re-enable pointer events.
        pointerEvents: "none",
        maxWidth: "min(420px, calc(100vw - var(--shell-pad) * 2))",
      }}
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>,
    document.body,
  );
}

const TONES: Record<ToastTone, { icon: string; color: string; tint: string; border: string }> = {
  success: {
    icon: "check",
    color: "var(--signal-up)",
    tint: "var(--signal-up-dim)",
    border: "rgba(95,208,138,.28)",
  },
  error: {
    icon: "triangle-alert",
    color: "var(--signal-down)",
    tint: "var(--signal-down-dim)",
    border: "rgba(242,116,139,.28)",
  },
  info: {
    icon: "info",
    color: "var(--text-secondary)",
    tint: "var(--surface-raised)",
    border: "var(--border-default)",
  },
};

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TONES[toast.tone];

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--radius-card)",
        background: "var(--glass-bg)",
        border: `1px solid ${tone.border}`,
        backdropFilter: "var(--glass-blur-heavy)",
        WebkitBackdropFilter: "var(--glass-blur-heavy)",
        boxShadow: "var(--shadow-4)",
        animation: "falorb-toast-in var(--dur-3) var(--ease-emphasis)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          flex: "0 0 auto",
          marginTop: 1,
          borderRadius: "var(--radius-1)",
          background: tone.tint,
          color: tone.color,
        }}
      >
        <Icon name={tone.icon} size={12} />
      </span>

      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "var(--size-label)",
          color: "var(--text-primary)",
          lineHeight: "var(--lh-normal)",
        }}
      >
        {toast.message}
      </span>

      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          marginTop: 1,
          padding: 0,
          border: "none",
          borderRadius: "var(--radius-1)",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

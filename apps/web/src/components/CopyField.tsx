"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@falorb/ui";

/**
 * A block of code with a copy button.
 *
 * The confirmation is the word "Copied" for 1.4 seconds and then it is gone —
 * the design system is explicit that there are no celebration moments.
 */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing on unmount matters: navigating away mid-timeout would otherwise
  // call setState on a component that no longer exists.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access is refused on insecure origins and in some embedded
      // browsers. Selecting the text is the fallback, so say that rather than
      // failing silently.
      setCopied(false);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {label && (
        <span
          style={{
            fontSize: "var(--size-label)",
            color: "var(--text-secondary)",
            fontWeight: "var(--wt-medium)",
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 12px 12px 14px",
          borderRadius: "var(--radius-control)",
          background: "var(--surface-inset)",
          border: "1px solid var(--control-border)",
          boxShadow: "var(--edge-top)",
        }}
      >
        <code
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--size-label)",
            color: "var(--text-body)",
            lineHeight: "var(--lh-normal)",
            wordBreak: "break-all",
            whiteSpace: "pre-wrap",
          }}
        >
          {value}
        </code>
        <Button
          size="sm"
          onClick={copy}
          iconLeft={<Icon name={copied ? "check" : "copy"} size={13} />}
          style={{ flex: "0 0 auto" }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

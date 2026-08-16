import Link from "next/link";

/**
 * No logo files exist for Falorb, so the mark is the name set in Instrument
 * Sans 600 at −5% tracking, beside the placeholder white square holding a
 * graphite "F". Documented as a substitute in the design system's assets note.
 */
export function Wordmark({ version }: { version?: string }) {
  return (
    <Link
      href="/"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 10px 14px",
        textDecoration: "none",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 6,
          background: "var(--ink-50)",
          color: "var(--ink-1000)",
          fontWeight: "var(--wt-semibold)",
          fontSize: 13,
          letterSpacing: "-.04em",
          flex: "0 0 auto",
        }}
      >
        F
      </span>
      <span
        style={{
          fontSize: 15,
          fontWeight: "var(--wt-semibold)",
          letterSpacing: "-.03em",
          color: "var(--text-primary)",
        }}
      >
        Falorb
      </span>
      {version && (
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-muted)",
          }}
        >
          {version}
        </span>
      )}
    </Link>
  );
}

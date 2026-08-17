import Link from "next/link";

/**
 * The Falorb lockup: the orb mark beside the name, in Instrument Sans 600 at
 * −3% tracking.
 *
 * The mark is an orb with something in orbit, drawn as a ring broken where the
 * satellite crosses it. Cutting the ring rather than haloing the dot is what
 * lets the whole thing be a single `currentColor` — so it inherits the text
 * colour and is correct in both themes without a second asset. This replaces
 * the white square holding a graphite "F" that stood in while no mark existed.
 */
export function Wordmark({ version }: { version?: string }) {
  return (
    <Link
      href="/"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "2px 10px 14px",
        textDecoration: "none",
        color: "var(--text-primary)",
      }}
    >
      <svg
        width={22}
        height={22}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        style={{ flex: "0 0 auto" }}
      >
        <path
          d="M20.45 3.78A13 13 0 1 0 28.22 11.55"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="25.19" cy="6.81" r="3.1" fill="currentColor" />
        <circle cx="16" cy="16" r="5.6" fill="currentColor" />
      </svg>
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

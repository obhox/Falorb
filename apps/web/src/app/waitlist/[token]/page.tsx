import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveWaitlistToken } from "@/server/waitlist";
import { WaitlistJoinForm } from "./WaitlistJoinForm";

export const dynamic = "force-dynamic";

/**
 * Public waitlist join widget, readable and submittable without an account.
 *
 * Outside the `(app)` route group for the same reason `/share/[token]` and
 * `/r/[code]` are: it must render for an anonymous visitor with no session,
 * and it must never inherit the authenticated shell by accident.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const waitlist = await resolveWaitlistToken((await params).token);

  return {
    title: waitlist ? `Join the ${waitlist.projectName} waitlist` : "Not found",
    // Unlisted, not public — the same rule as the share link.
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function WaitlistJoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { token } = await params;
  const waitlist = await resolveWaitlistToken(token);
  if (!waitlist) notFound();

  const search = await searchParams;
  const ref = Array.isArray(search.ref) ? search.ref[0] : search.ref;

  return (
    <main
      style={{
        height: "100%",
        overflowY: "auto",
        display: "grid",
        placeItems: "center",
        background: "var(--bg-app)",
        padding: "var(--space-9)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440, display: "grid", gap: "var(--space-6)" }}>
        <header style={{ display: "grid", gap: 6, textAlign: "center" }}>
          <h1 style={{ fontSize: "var(--size-title)", fontWeight: "var(--wt-semibold)" }}>
            {waitlist.projectName}
          </h1>
          <p style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)" }}>
            Join the waitlist for early access. Invite friends afterward to move up the line.
          </p>
        </header>

        <WaitlistJoinForm token={token} projectName={waitlist.projectName} referredByCode={ref} />

        <footer
          style={{
            textAlign: "center",
            fontSize: "var(--size-micro)",
            color: "var(--text-muted)",
          }}
        >
          Powered by Falorb.
        </footer>
      </div>
    </main>
  );
}

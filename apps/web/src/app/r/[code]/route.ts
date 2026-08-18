import { NextResponse } from "next/server";
import { resolveReferralLink } from "@/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where an unresolvable code lands — this route never dead-ends a real visitor. */
const FALLBACK_URL = process.env.FALORB_APP_URL ?? "http://localhost:3000";

/**
 * Public redirect for a referral link.
 *
 * Outside the `(app)` auth group, same reasoning as `/share/[token]`: it must
 * resolve for an anonymous visitor with no session. 302, not 301 — a link's
 * destination and revocation state can change after it has already been
 * distributed, and a 301 risks a browser or crawler caching a stale target
 * permanently.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveReferralLink(code);

  const destination = target
    ? (target.destinationUrl ?? (target.domain ? `https://${target.domain}` : FALLBACK_URL))
    : FALLBACK_URL;

  const url = new URL(destination);
  if (target) url.searchParams.set("ref_code", target.code);

  return NextResponse.redirect(url.toString(), {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}

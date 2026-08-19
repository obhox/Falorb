import { NextResponse } from "next/server";
import { resolveReferralLink } from "@/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where an unresolvable code lands — this route never dead-ends a real visitor. */
const FALLBACK_URL = process.env.FALORB_APP_URL ?? "http://localhost:3000";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Standalone HTML, no dependency on the app's CSS/build pipeline — this
 * response has to render correctly even if it's the very first thing a
 * visitor's browser ever loads from this origin. The meta-refresh is the
 * primary mechanism (works with JS disabled); the visible link is the
 * fallback for a visitor who reads before the 3s elapse.
 */
function incentiveInterstitial(destination: string, value: string | null, description: string | null): string {
  const safeDestination = escapeHtml(destination);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3;url=${safeDestination}">
<title>${value ? escapeHtml(value) : "Your referral reward"}</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;box-sizing:border-box;">
<div style="max-width:420px;width:100%;text-align:center;">
${value ? `<div style="font-size:28px;font-weight:700;margin-bottom:12px;">${escapeHtml(value)}</div>` : ""}
${description ? `<p style="font-size:15px;line-height:1.5;color:#c7c7c7;margin:0 0 28px;">${escapeHtml(description)}</p>` : ""}
<a href="${safeDestination}" style="display:inline-block;padding:12px 28px;border-radius:8px;background:#f5f5f5;color:#0a0a0a;text-decoration:none;font-weight:600;font-size:15px;">Continue to ${safeDestination}</a>
<p style="font-size:12px;color:#8a8a8a;margin:20px 0 0;">Redirecting automatically in a few seconds&hellip;</p>
</div>
</body>
</html>`;
}

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
  const finalUrl = url.toString();

  // No incentive on this link — same instant 302 as before, byte-identical.
  if (!target?.incentiveKind) {
    return NextResponse.redirect(finalUrl, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const html = incentiveInterstitial(finalUrl, target.incentiveValue, target.incentiveDescription);
  return new Response(html, {
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
  });
}

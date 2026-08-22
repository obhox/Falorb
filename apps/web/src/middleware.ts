import { NextResponse, type NextRequest } from "next/server";
import { isNotNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { clientKey, LIMITS, rateLimiter } from "@/server/rate-limit";

// Needs real Postgres access (the `postgres` driver uses raw TCP sockets),
// which the default Edge runtime cannot provide — see `isConfiguredLinkDomain`.
export const runtime = "nodejs";

/**
 * Content Security Policy, per request, with a fresh nonce.
 *
 * The dashboard shipped no CSP at all. That matters more here than it would in
 * most products: this is an analytics console whose entire business is
 * injecting a script into other people's pages, so "a stray script executes
 * where it should not" is the failure mode the product is built around. A
 * policy is also the difference between a stored-XSS bug being a full session
 * compromise and being nothing.
 *
 * The nonce lives in middleware because that is the only layer that runs
 * before render and can vary per response. Next reads the policy off the
 * request headers and stamps the same nonce onto the framework's own inline
 * bootstrap and flight-data scripts, so `'strict-dynamic'` covers everything
 * Next loads without the policy having to enumerate it.
 *
 * `'unsafe-inline'` remains on `style-src` deliberately: React writes inline
 * `style` attributes for anything computed at render time, and there is no
 * nonce mechanism for those. It is the weakest line in the policy and it is
 * also the one with no alternative that does not mean rewriting the charts.
 *
 * Almost nothing in this app loads a cross-origin asset — fonts are
 * self-hosted by `next/font`, there are no `<img>` tags and no CDN — so every
 * other directive is `'self'`, and `default-src 'none'` makes anything
 * overlooked fail closed.
 *
 * `media-src` is the one exception, and it exists because of `/ugc-videos`
 * (FEATURES.md §18): a generated video is played from ElevenLabs' own output
 * URL and voice previews from ElevenLabs' hosted samples, neither of which
 * Falorb re-hosts. Under `default-src 'none'` both were being blocked
 * outright — the player rendered and simply never played. See
 * `ELEVENLABS_MEDIA_ORIGINS` for why the allowlist is a named host rather
 * than a blanket `https:`.
 */

const isDev = process.env.NODE_ENV !== "production";

/**
 * Where ElevenLabs serves generated videos and voice previews from.
 *
 * Deliberately a named host rather than `https:`. This policy's whole
 * posture is that anything not enumerated fails closed, and widening media
 * to the entire web to play one vendor's clips would be the largest hole in
 * it — in an app whose business is injecting scripts into other people's
 * pages.
 *
 * The cost of being this narrow is that if ElevenLabs moves its output
 * storage, videos stop playing until this list is updated. That failure is
 * loud (a blocked-by-CSP message in the console, an empty player) and the
 * fix is one line here. `storage.googleapis.com` is the host ElevenLabs'
 * published `content_url` examples use — verify against a real generation
 * and add whatever else it turns out to serve from.
 */
const ELEVENLABS_MEDIA_ORIGINS = "https://storage.googleapis.com";

function buildCsp(nonce: string): string {
  return [
    "default-src 'none'",
    // 'unsafe-eval' is required by Next's dev-mode hot reloader and must never
    // reach production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // blob: covers the local preview of a presenter photo before it is
    // uploaded; the remote origin covers the finished video and voice samples.
    `media-src 'self' blob: ${ELEVENLABS_MEDIA_ORIGINS}`,
    "font-src 'self'",
    // Same-origin only. The dashboard talks to its own routes — including the
    // `/api/live` event stream — and never to the collector from the browser.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Which hosts are configured as a project's branded referral-link domain.
 *
 * A plain `Set` of hostnames is enough — the middleware only needs to decide
 * *whether* a Host is a link domain at all, not which project it belongs to.
 * `/r/[code]`'s own lookup resolves the code to a project independently of
 * which domain the visitor arrived on, since a referral code is already
 * globally unique.
 *
 * Cached in-memory rather than queried per request: this runs in front of
 * every page view, and the set of configured link domains (bounded by the
 * number of properties, not by traffic) changes rarely enough that a
 * short-lived cache costs nothing real in staleness.
 */
let linkDomainCache: { fetchedAt: number; domains: Set<string> } | null = null;
const LINK_DOMAIN_CACHE_TTL_MS = 30_000;

async function isConfiguredLinkDomain(host: string): Promise<boolean> {
  const now = Date.now();
  if (!linkDomainCache || now - linkDomainCache.fetchedAt > LINK_DOMAIN_CACHE_TTL_MS) {
    const rows = await db()
      .select({ linkDomain: schema.projects.linkDomain })
      .from(schema.projects)
      .where(isNotNull(schema.projects.linkDomain));
    linkDomainCache = {
      fetchedAt: now,
      domains: new Set(rows.map((row) => row.linkDomain!.toLowerCase())),
    };
  }
  return linkDomainCache.domains.has(host.toLowerCase());
}

/**
 * The unauthenticated, token-addressed surface.
 *
 * Everything else in the dashboard is behind a session. These five are
 * deliberately public — a shared report, an embeddable badge, a benchmark
 * page, a waitlist form, a referral redirect — and each runs real ClickHouse
 * or Postgres work per request. Guessing a 32-byte token is not the threat;
 * exhausting the query budget that serves every tenant with a loop against one
 * known link is, and until now nothing bounded that.
 */
const PUBLIC_PREFIXES = ["/share/", "/badge/", "/benchmark/", "/waitlist/", "/r/"];

function isPublicSurface(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0] ?? "";

  if (isPublicSurface(request.nextUrl.pathname)) {
    const verdict = await rateLimiter().check(
      "public",
      clientKey(request.headers),
      LIMITS.publicRead,
    );
    if (!verdict.allowed) {
      // Plain text, not the app shell: this is served to something in a loop,
      // and rendering a styled error page for it would spend exactly the work
      // the limit exists to avoid.
      return new NextResponse("Too many requests. Try again shortly.\n", {
        status: 429,
        headers: {
          "Retry-After": String(verdict.retryAfterSeconds),
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  // A branded link domain's whole purpose is `<domain>/<code>` reading as a
  // short link, so a non-root path on a configured host is treated as a
  // referral code and rewritten to the real route — the visitor's URL bar
  // keeps showing their own domain throughout. The bare root path (no code)
  // falls through to the ordinary app, which is an acceptable edge case:
  // nobody is expected to visit the bare go-domain with nothing appended.
  if (host && request.nextUrl.pathname !== "/" && (await isConfiguredLinkDomain(host))) {
    const url = request.nextUrl.clone();
    url.pathname = `/r${request.nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }

  /**
   * The badge gets the rate limit above but not the policy below.
   *
   * It is a public widget whose entire purpose is to render inside an
   * <iframe> on a property owner's own site, and this policy sets
   * `frame-ancestors 'none'`. It used to be excluded from the matcher
   * altogether to achieve that — which also excluded it from anything else
   * middleware might ever need to do, and the rate limit is the first such
   * thing. Handled here instead: in the matcher, out of the CSP. The route
   * sets its own, lighter headers.
   */
  if (request.nextUrl.pathname.startsWith("/badge/")) {
    return NextResponse.next();
  }

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  // Next looks for the policy on the *request* to discover the nonce it should
  // apply to its own injected scripts; the response header is what the browser
  // enforces. Both are required.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except static output and the collector-facing asset routes.
     *
     * `/api/live` is excluded on purpose: it is a long-lived server-sent event
     * stream, and passing it through middleware buys nothing while adding a
     * layer that can buffer it.
     */
    {
      // `badge/` *is* matched, and opts out of the CSP inside the handler
      // rather than by being invisible to middleware — it still needs the
      // rate limit, being one of the public token routes.
      source: "/((?!api/live|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

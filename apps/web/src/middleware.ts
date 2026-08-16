import { NextResponse, type NextRequest } from "next/server";

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
 * Nothing in this app loads a cross-origin asset — fonts are self-hosted by
 * `next/font`, there are no `<img>` tags and no CDN — so every other directive
 * is `'self'`, and `default-src 'none'` makes anything overlooked fail closed.
 */

const isDev = process.env.NODE_ENV !== "production";

function buildCsp(nonce: string): string {
  return [
    "default-src 'none'",
    // 'unsafe-eval' is required by Next's dev-mode hot reloader and must never
    // reach production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
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

export function middleware(request: NextRequest) {
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
      source: "/((?!api/live|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

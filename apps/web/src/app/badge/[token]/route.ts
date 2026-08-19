import { resolveShare } from "@/server/sharing";
import { liveCounts, totals } from "@/server/analytics";
import { resolveRange } from "@/lib/range";
import { num } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public embeddable "trusted by N people" badge — a route handler, not a
 * page.
 *
 * It has to be a route handler for two reasons. First, response headers: a
 * badge embedded on someone else's site gets fetched on every one of their
 * page loads, so this needs its own `Cache-Control` rather than hitting
 * ClickHouse per view (the resolveShare/totals/liveCounts calls stay
 * `force-dynamic` so a revoked or rotated token stops resolving immediately —
 * the caching happens downstream, in the visitor's browser and any CDN in
 * front of it, not here). Second, framing: this route is excluded from the
 * blanket `X-Frame-Options: DENY` in next.config.js and from the
 * `frame-ancestors 'none'` CSP middleware.ts sets on everything else — an
 * <iframe>-embeddable badge cannot carry either. Both carve-outs live next to
 * this comment because the reasoning for one only makes sense with the other.
 *
 * The markup is hand-rolled HTML with inline CSS, not the design system: this
 * document has to render correctly with no app stylesheet, on an unknown
 * host, typically inside a ~300x100 iframe.
 */

const ORIGIN = (process.env.FALORB_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

// Short enough that a revoked link stops appearing to work within minutes;
// long enough that a busy embed does not re-run the query on every view.
const CACHE_CONTROL = "public, max-age=120, s-maxage=120, stale-while-revalidate=300";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f4f4f4;
    --card-bg: #ffffff;
    --border: rgba(0,0,0,.08);
    --text: #16171a;
    --text-muted: #6b6f76;
    --accent: #4f46e5;
    --shadow: 0 1px 2px rgba(0,0,0,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000000;
      --card-bg: #131316;
      --border: rgba(255,255,255,.1);
      --text: #f4f4f5;
      --text-muted: #9a9ba1;
      --accent: #a5a0ff;
      --shadow: none;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .badge {
    width: 300px;
    max-width: 100%;
    height: 100px;
    max-height: 100%;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-radius: 10px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .label {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stat { display: flex; align-items: baseline; gap: 6px; }
  .number { font-size: 26px; font-weight: 700; color: var(--text); line-height: 1; }
  .unit { font-size: 11px; color: var(--text-muted); }
  .live { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; flex: none; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
  .brand { font-size: 10px; color: var(--accent); text-decoration: none; font-weight: 600; }
  .brand:hover { text-decoration: underline; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function brandLink(): string {
  return `<a class="brand" href="${ORIGIN}/" target="_blank" rel="noopener noreferrer">Powered by Falorb ↗</a>`;
}

function notFound(): Response {
  const body = `<div class="badge">
  <span class="label">Not found</span>
  <div class="stat"><span class="number">—</span></div>
  ${brandLink()}
</div>`;

  return new Response(shell("Not found", body), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_CONTROL },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share) return notFound();

  // Fixed 30-day window — a badge is a passive loop, not a dashboard, so it
  // does not need a range picker.
  const resolved = resolveRange({ range: "30d" });
  const scope = { projectIds: [share.projectId], range: resolved.range };

  const [current, live] = await Promise.all([
    totals(scope),
    liveCounts({ projectIds: [share.projectId] }),
  ]);

  const liveNow = live.find((row) => row.project_id === share.projectId)?.visitors ?? 0;
  // The domain is what a visitor to the *embedder's* site recognises; the
  // internal Falorb project name is not.
  const label = share.domain ?? share.projectName;

  const body = `<div class="badge">
  <span class="label">${escapeHtml(label)}</span>
  <div>
    <div class="stat">
      <span class="number">${escapeHtml(num(current.visitors))}</span>
      <span class="unit">visitors this month</span>
    </div>
    ${liveNow > 0 ? `<div class="live"><span class="dot"></span>${escapeHtml(num(liveNow))} online now</div>` : ""}
  </div>
  ${brandLink()}
</div>`;

  return new Response(shell(`${escapeHtml(label)} — analytics`, body), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": CACHE_CONTROL },
  });
}

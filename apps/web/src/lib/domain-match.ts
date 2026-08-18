/**
 * Matching collected hosts to configured domains.
 *
 * Pure, and separate from `server/connection.ts`, because this is the part that
 * can be wrong in a way nobody notices: attribute an event to the wrong domain
 * and the settings page reports a broken install as working, which is the exact
 * failure the connection panel exists to prevent. It is also the only part
 * worth testing without a ClickHouse instance.
 *
 * The rule is the collector's own, from `originAllowed` in the ingest service:
 * hosts and domains are compared lowercased with a leading `www.` dropped, and
 * a configured apex authorises every subdomain beneath it. Anything that
 * diverges from that here would report traffic the collector is happily
 * accepting as never having arrived.
 */

/** Lowercase, trim, drop a leading `www.` — exactly what the collector does. */
export function normaliseHost(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * Which configured domain owns a host, or null if none does.
 *
 * Longest match wins, so with both `evyos.com` and `app.evyos.com` configured
 * an event on `app.evyos.com` belongs to the specific entry rather than being
 * folded into the apex — otherwise adding the subdomain to the list would make
 * its own row look permanently uninstalled.
 */
export function ownerOf(host: string, domains: string[]): string | null {
  const target = normaliseHost(host);
  if (!target) return null;

  let best: { domain: string; length: number } | null = null;

  for (const domain of domains) {
    const match = normaliseHost(domain);
    if (!match) continue;
    if (target !== match && !target.endsWith(`.${match}`)) continue;
    if (!best || match.length > best.length) best = { domain, length: match.length };
  }

  return best?.domain ?? null;
}

import { open, type Reader, type CityResponse, type AsnResponse } from "maxmind";

export interface GeoResult {
  country: string;
  region: string;
  city: string;
  asn: number;
  asnOrg: string;
}

const EMPTY: GeoResult = { country: "", region: "", city: "", asn: 0, asnOrg: "" };

let cityReader: Reader<CityResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;

/**
 * Load the MaxMind databases into memory once at boot.
 *
 * Geo lookup is deliberately in-process: a network call to a geo API on every
 * pageview would dominate the request budget and add a hard dependency to the
 * hot path. Loading the .mmdb costs ~70MB of RSS and turns lookup into a few
 * microseconds of memory access.
 *
 * Absence is not fatal. Without the database, events are still collected and
 * every geo field is simply empty — far better than refusing to start and
 * losing traffic because a licence key expired.
 */
export async function initGeo(cityPath: string): Promise<boolean> {
  if (!cityPath) {
    console.warn("[geo] MAXMIND_DB_PATH not set — geo enrichment disabled");
    return false;
  }
  try {
    cityReader = await open<CityResponse>(cityPath);
  } catch (error) {
    console.warn(`[geo] could not open ${cityPath} — geo enrichment disabled:`, String(error));
    return false;
  }

  // The ASN database is a separate file and is optional; it only drives the
  // "skip company lookup for consumer ISPs" optimisation.
  const asnPath = cityPath.replace(/GeoLite2-City\.mmdb$/, "GeoLite2-ASN.mmdb");
  if (asnPath !== cityPath) {
    try {
      asnReader = await open<AsnResponse>(asnPath);
    } catch {
      console.warn("[geo] ASN database not found — company enrichment will not be filtered by ASN");
    }
  }
  return true;
}

export function lookupGeo(ip: string): GeoResult {
  if (!cityReader || !ip) return EMPTY;
  try {
    const city = cityReader.get(ip);
    const asn = asnReader?.get(ip);
    return {
      country: city?.country?.iso_code ?? "",
      region: city?.subdivisions?.[0]?.names?.en ?? "",
      city: city?.city?.names?.en ?? "",
      asn: asn?.autonomous_system_number ?? 0,
      asnOrg: asn?.autonomous_system_organization ?? "",
    };
  } catch {
    return EMPTY;
  }
}

/**
 * How many reverse proxies sit between the internet and this process.
 *
 * One by default, which matches both deployment paths: Caddy in
 * `infra/Caddyfile` and Coolify's own proxy in the production stack. Set
 * `FALORB_TRUSTED_PROXY_COUNT` if you add another hop (a CDN in front, say).
 */
const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.FALORB_TRUSTED_PROXY_COUNT ?? 1) || 1);

/** Cheap plausibility check — rejects header junk before it reaches MaxMind. */
function looksLikeIp(value: string): boolean {
  if (!value || value.length > 45) return false;
  return /^[0-9.]+$/.test(value) || /^[0-9a-fA-F:.]+$/.test(value);
}

/**
 * Extract the client IP from proxy headers.
 *
 * Read from the **right**, not the left. Each proxy appends the address it
 * received the request from, so with N trusted proxies the genuine peer is the
 * Nth entry from the end — everything to its left was supplied by the client
 * and is forgeable. Taking the leftmost entry meant anyone could set
 * `X-Forwarded-For: 1.2.3.4` and choose their own identity, which in this
 * service selects the rate-limit bucket, the geo attribution and the daily
 * `ip_hash` that stitches sessions together.
 *
 * That was survivable while `infra/Caddyfile` overwrote the header with
 * `{remote_host}`, but the production stack routes through Coolify's proxy
 * instead and never loads that file. A parser that is correct on its own does
 * not depend on which proxy happens to be in front.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (entries.length) {
      // N proxies append N entries; the client-facing one is at length - N.
      const candidate = entries[Math.max(0, entries.length - TRUSTED_PROXY_COUNT)];
      if (candidate && looksLikeIp(candidate)) return candidate;
    }
  }

  // Set by the infrastructure, not forwarded from the client, so these are
  // single-valued and safe to read directly.
  const direct = headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "";
  return looksLikeIp(direct) ? direct : "";
}

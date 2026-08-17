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

/**
 * Country from an edge proxy header, when the database cannot supply one.
 *
 * Cloudflare, and most CDNs, resolve the country before the request ever
 * reaches us and pass it in a header. That is a free, accurate country code
 * with no 70MB database, no licence key and no lookup cost — so when MaxMind
 * is absent or misses an address, this is a far better answer than an empty
 * field.
 *
 * It is strictly a *fallback*, never an override. MaxMind returns country,
 * region, city and ASN together; the header carries only a country, so
 * preferring it would trade three fields for one.
 *
 * These headers are only meaningful because they are set by the proxy in front
 * of this service. A request that reaches the collector directly can forge
 * them, which is why `trustProxyHeaders` gates the whole thing on there being
 * a proxy in front at all — the same assumption `clientIp` already makes when
 * it reads X-Forwarded-For.
 */
const COUNTRY_HEADERS = [
  "cf-ipcountry", // Cloudflare
  "x-vercel-ip-country", // Vercel
  "fastly-client-country-code", // Fastly
  "x-geo-country", // common convention for a self-managed edge
] as const;

/**
 * Values that mean "no country", not a country.
 *
 * Cloudflare sends XX when it cannot determine one and T1 for traffic arriving
 * over Tor. Storing either as a country would invent a place.
 */
const NOT_A_COUNTRY = new Set(["XX", "T1", "ZZ", "AP", "EU", "UNKNOWN"]);

export function countryFromHeaders(headers: Headers): string {
  // There is always at least one proxy in the deployed topology, which is what
  // TRUSTED_PROXY_COUNT already encodes for X-Forwarded-For. A value of 0 would
  // mean the collector is exposed directly and no forwarded header can be
  // trusted, including this one.
  if (TRUSTED_PROXY_COUNT < 1) return "";

  for (const name of COUNTRY_HEADERS) {
    const raw = headers.get(name);
    if (!raw) continue;

    const code = raw.trim().toUpperCase();
    // ISO 3166-1 alpha-2, and nothing else. Anything longer is not a country
    // code and must not reach a column the UI renders as a place name.
    if (code.length !== 2 || !/^[A-Z]{2}$/.test(code)) continue;
    if (NOT_A_COUNTRY.has(code)) continue;

    return code;
  }

  return "";
}

/**
 * Geo for one request: the database where it can answer, the edge header where
 * it cannot.
 */
export function resolveGeo(ip: string, headers: Headers): GeoResult {
  const geo = lookupGeo(ip);
  if (geo.country) return geo;

  const country = countryFromHeaders(headers);
  return country ? { ...geo, country } : geo;
}

/** Whether geo is available at all, by either route. */
export function geoSources(headers?: Headers): { database: boolean; header: boolean } {
  return {
    database: cityReader !== null,
    header: headers ? countryFromHeaders(headers) !== "" : TRUSTED_PROXY_COUNT >= 1,
  };
}

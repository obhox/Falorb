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
 * Extract the client IP from proxy headers.
 *
 * Only the leftmost X-Forwarded-For entry is trusted, and only because this
 * service is expected to sit behind a trusted reverse proxy (Caddy on the
 * Coolify host). Exposed directly to the internet, this header is
 * client-controlled and spoofable.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "";
}

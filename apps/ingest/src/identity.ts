import { createHash } from "node:crypto";

/**
 * Identity derivation, all of it pure and in-memory. Nothing here touches a
 * database, because every one of these runs on the ingest hot path for every
 * event.
 */

/**
 * Hash an IP address with a salt that rotates daily.
 *
 * The raw address is never stored, and because the salt changes every UTC day
 * the hash cannot be correlated across days even by whoever holds the database.
 * It exists only to stitch a session together and to rate-limit abuse within a
 * single day.
 */
export function hashIp(ip: string, projectId: number, secret: string, at: Date = new Date()): string {
  const day = at.toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${secret}:${day}:${projectId}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Derive a stable person UUID from a project's distinct_id.
 *
 * Deterministic on purpose: ingest must assign a person without a database
 * round-trip, and the same device must always land on the same id. Later
 * merges do not rewrite these — they are remapped at read time through the
 * person_overrides dictionary.
 *
 * Formatted as a valid v4-shaped UUID so ClickHouse's UUID column accepts it
 * and so it is indistinguishable from a random one in the UI.
 */
export function derivePersonId(projectId: number, distinctId: string): string {
  const h = createHash("sha256").update(`falorb:person:${projectId}:${distinctId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Session ids arrive as opaque client strings; normalise to a UUID for storage. */
export function deriveSessionId(projectId: number, rawSessionId: string): string {
  return derivePersonId(projectId, `session:${rawSessionId}`);
}

export interface CrossDomainLink {
  deviceId: string;
  issuedAt: number;
}

/**
 * Decode the `_pl` token a sibling first-party domain appended to an outbound
 * link. Rejected if older than two minutes so a token that ends up shared,
 * bookmarked, or indexed by a crawler cannot merge unrelated people.
 */
export function decodeCrossDomainToken(
  token: string,
  now: number = Date.now(),
  maxAgeMs = 120_000,
): CrossDomainLink | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const sep = decoded.lastIndexOf(".");
    if (sep < 1) return null;
    const deviceId = decoded.slice(0, sep);
    const issuedAt = Number(decoded.slice(sep + 1));
    if (!deviceId || !Number.isFinite(issuedAt)) return null;
    if (now - issuedAt > maxAgeMs || issuedAt - now > 60_000) return null;
    return { deviceId, issuedAt };
  } catch {
    return null;
  }
}

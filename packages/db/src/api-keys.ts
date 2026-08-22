import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, or, gt } from "drizzle-orm";
import type { Database } from "./index";
import * as schema from "./schema/index";

/**
 * Server-side API key issuance and verification.
 *
 * Keys are stored only as a SHA-256 digest; the plaintext is shown once at
 * creation and is unrecoverable afterwards. A leaked database therefore yields
 * no usable credentials.
 *
 * SHA-256 rather than a password hash is the right choice here specifically
 * because these are high-entropy random tokens, not user-chosen passwords.
 * Argon2's cost exists to defeat dictionary attacks on guessable inputs; there
 * is nothing to guess in 256 bits of randomness, and paying that cost on every
 * API request would only make the endpoint easy to exhaust.
 */

const PREFIX = "falorb_sk_";

export interface IssuedKey {
  /** Shown to the user exactly once. */
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
}

export function generateApiKey(): IssuedKey {
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `${PREFIX}${secret}`;
  return {
    plaintext,
    keyHash: hashApiKey(plaintext),
    // Enough to recognise a key in a list without being enough to use it.
    keyPrefix: plaintext.slice(0, PREFIX.length + 6),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Compare two hashes without leaking timing information.
 *
 * The lookup below is by hash equality in SQL, which is already constant-time
 * enough in practice; this exists for callers holding a candidate hash in
 * memory.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerifiedKey {
  id: string;
  organizationId: string;
  projectId: number | null;
  scopes: string[];
  /**
   * The membership role this key acts with — see `api_keys.role`.
   *
   * Returned alongside the scopes because a caller needs both to authorise
   * anything: scopes say read-or-write, the role says whether this credential
   * is entitled to that class of change at all. Consumers that check only
   * scopes are the reason a `write` key could once promote a member to owner.
   */
  role: string;
}

/**
 * Resolve a presented key to its record, or null.
 *
 * Rejects revoked and expired keys in the query itself rather than after the
 * fetch, so an expired key cannot be used through a code path that forgets to
 * check.
 */
export async function verifyApiKey(
  db: Database,
  plaintext: string,
): Promise<VerifiedKey | null> {
  if (!plaintext.startsWith(PREFIX)) return null;

  const [row] = await db
    .select()
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.keyHash, hashApiKey(plaintext)),
        isNull(schema.apiKeys.revokedAt),
        or(isNull(schema.apiKeys.expiresAt), gt(schema.apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Fire-and-forget: last-used tracking must not add latency to, or fail, the
  // request being authenticated.
  void db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id))
    .catch(() => {});

  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    scopes: row.scopes ?? [],
    // Falls back to the least privileged role rather than the column default:
    // a null here means a row this code does not understand, and an
    // unrecognised role must never resolve to more authority than the caller
    // can demonstrate. Same reasoning as `rankOf` treating unknown as viewer.
    role: row.role ?? "viewer",
  };
}

export function hasScope(key: VerifiedKey, scope: string): boolean {
  return key.scopes.includes("*") || key.scopes.includes(scope);
}

/**
 * Public (tracker) key for a project. Not a secret — it ships in the page
 * source — so it is stored in plaintext and authorised by Origin instead.
 */
export function generatePublicKey(): string {
  return `prj_${randomBytes(16).toString("hex")}`;
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope encryption for third-party integration credentials (Clay API keys
 * today). The rest of this codebase only ever needs one-way hashing — see
 * `api-keys.ts` — because API keys, invite tokens and team tokens are all
 * high-entropy secrets *we* mint and never need back. A Clay API key is the
 * opposite: it must be presented back to Clay's own API on every enrichment
 * call, so it has to be recoverable, not just verifiable.
 *
 * AES-256-GCM keyed by FALORB_CREDENTIAL_KEY (32 raw bytes, hex-encoded in
 * the environment). GCM's authentication tag means a corrupted or tampered
 * ciphertext fails to decrypt rather than silently returning garbage.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const FORMAT_VERSION = "v1";

function loadKey(): Buffer {
  const hex = process.env.FALORB_CREDENTIAL_KEY;
  if (!hex) {
    throw new Error(
      "FALORB_CREDENTIAL_KEY is not set — required to store or read an integration credential. Generate one with: openssl rand -hex 32",
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("FALORB_CREDENTIAL_KEY must be 32 bytes (64 hex characters).");
  }
  return key;
}

/** Encrypt a plaintext secret for storage. Throws if the key is missing or malformed. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]).toString("base64");
  return `${FORMAT_VERSION}:${payload}`;
}

/**
 * Decrypt a stored secret. Throws on a missing/wrong key, a malformed
 * payload, or a failed auth-tag check (corrupt or tampered ciphertext) —
 * callers that run unattended (the Clay-enrichment worker job) must catch
 * this per-organization so one org's bad key cannot abort the whole sweep.
 */
export function decryptSecret(stored: string): string {
  const key = loadKey();
  const [version, payload] = stored.split(":", 2);
  if (version !== FORMAT_VERSION || !payload) {
    throw new Error("Unrecognized encrypted-credential format.");
  }
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Last 4 characters, for showing "which key is stored" without exposing it. */
export function previewSecret(plaintext: string): string {
  return plaintext.slice(-4);
}

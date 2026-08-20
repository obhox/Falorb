import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption for credentials Falorb must read back in plaintext.
 *
 * `api_keys.keyHash` is one-way on purpose: Falorb only ever compares a
 * caller-presented value against it, never needs the plaintext again. The
 * integration credentials this module protects are the opposite case — a
 * Linki or Bund AI API key Falorb's own worker must present outbound on every
 * sync — so a hash cannot substitute here. AES-256-GCM was chosen over a
 * simpler scheme because it authenticates the ciphertext: a tampered or
 * truncated row fails to decrypt loudly instead of yielding a corrupted key
 * that gets sent to a third party.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Standard for GCM; 16 bytes gains nothing and costs interoperability with some tooling.
const KEY_LENGTH = 32; // 256 bits.

export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Reads and validates `INTEGRATION_CREDENTIAL_ENC_KEY` on every call rather
 * than caching it at module load, so a key configured after this module was
 * first imported (common across the worker's job-registration order) is
 * still picked up.
 */
function loadKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.INTEGRATION_CREDENTIAL_ENC_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_ENC_KEY is not set. Generate one with " +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` " +
        "and set it before storing or reading any integration credential.",
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `INTEGRATION_CREDENTIAL_ENC_KEY must be ${KEY_LENGTH} bytes of hex (${KEY_LENGTH * 2} characters); got ${key.length} bytes.`,
    );
  }
  return key;
}

export function encryptCredential(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): EncryptedCredential {
  const key = loadKey(env);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = loadKey(env);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "hex"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

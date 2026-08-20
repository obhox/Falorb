import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, previewSecret } from "./crypto";

const KEY = "0cd2e68582f276c467176a49b5fa8c818e33890686555872fc19c364e37f690e"; // 64 hex chars (32 bytes)

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    process.env.FALORB_CREDENTIAL_KEY = KEY;
  });

  it("round-trips a plaintext secret", () => {
    const ciphertext = encryptSecret("clay_live_abc123");
    expect(ciphertext).not.toContain("clay_live_abc123");
    expect(decryptSecret(ciphertext)).toBe("clay_live_abc123");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-plaintext");
    const b = encryptSecret("same-plaintext");
    expect(a).not.toBe(b);
  });

  it("throws on a tampered ciphertext", () => {
    const ciphertext = encryptSecret("clay_live_abc123");
    const tampered = ciphertext.slice(0, -4) + "0000";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws when the key is missing", () => {
    delete process.env.FALORB_CREDENTIAL_KEY;
    expect(() => encryptSecret("x")).toThrow(/FALORB_CREDENTIAL_KEY/);
  });

  it("throws when the key is the wrong length", () => {
    process.env.FALORB_CREDENTIAL_KEY = "too-short";
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});

describe("previewSecret", () => {
  it("returns the last 4 characters", () => {
    expect(previewSecret("clay_live_abc123")).toBe("c123");
  });
});

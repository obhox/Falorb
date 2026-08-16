import { describe, expect, it } from "vitest";
import { decodeCrossDomainToken, derivePersonId, deriveSessionId, hashIp } from "./identity";

const SECRET = "test-secret-at-least-16-chars-long";

describe("hashIp", () => {
  it("is stable within a day", () => {
    const day = new Date("2026-08-16T10:00:00Z");
    const later = new Date("2026-08-16T23:59:00Z");
    expect(hashIp("1.2.3.4", 1, SECRET, day)).toBe(hashIp("1.2.3.4", 1, SECRET, later));
  });

  it("changes across days, so an IP cannot be correlated over time", () => {
    const d1 = new Date("2026-08-16T10:00:00Z");
    const d2 = new Date("2026-08-17T10:00:00Z");
    expect(hashIp("1.2.3.4", 1, SECRET, d1)).not.toBe(hashIp("1.2.3.4", 1, SECRET, d2));
  });

  it("differs per project, so hashes cannot be joined across tenants", () => {
    const d = new Date("2026-08-16T10:00:00Z");
    expect(hashIp("1.2.3.4", 1, SECRET, d)).not.toBe(hashIp("1.2.3.4", 2, SECRET, d));
  });

  it("never contains the address itself", () => {
    const h = hashIp("192.168.1.55", 1, SECRET, new Date("2026-08-16T00:00:00Z"));
    expect(h).not.toContain("192");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("derivePersonId", () => {
  it("is deterministic, so ingest needs no database lookup", () => {
    expect(derivePersonId(1, "device-abc")).toBe(derivePersonId(1, "device-abc"));
  });

  it("differs per project for the same device id", () => {
    expect(derivePersonId(1, "device-abc")).not.toBe(derivePersonId(2, "device-abc"));
  });

  it("produces a valid v4-shaped UUID that ClickHouse will accept", () => {
    expect(derivePersonId(1, "device-abc")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("does not collide with the session id derived from the same input", () => {
    expect(derivePersonId(1, "x")).not.toBe(deriveSessionId(1, "x"));
  });
});

describe("decodeCrossDomainToken", () => {
  const now = 1_800_000_000_000;
  const token = (device: string, issuedAt: number) =>
    Buffer.from(`${device}.${issuedAt}`).toString("base64").replace(/=+$/, "");

  it("accepts a fresh token", () => {
    const r = decodeCrossDomainToken(token("dev-1", now - 5_000), now);
    expect(r).toEqual({ deviceId: "dev-1", issuedAt: now - 5_000 });
  });

  it("rejects a token older than the window, so shared links cannot merge people", () => {
    expect(decodeCrossDomainToken(token("dev-1", now - 500_000), now)).toBeNull();
  });

  it("rejects a token issued implausibly far in the future", () => {
    expect(decodeCrossDomainToken(token("dev-1", now + 600_000), now)).toBeNull();
  });

  it("returns null on garbage rather than throwing", () => {
    expect(decodeCrossDomainToken("!!!not-base64!!!", now)).toBeNull();
    expect(decodeCrossDomainToken("", now)).toBeNull();
  });
});

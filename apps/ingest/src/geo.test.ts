import { describe, expect, it } from "vitest";
import { countryFromHeaders, resolveGeo } from "./geo";

/**
 * The edge-header country fallback.
 *
 * This path takes a value from a request header and stores it in a column the
 * dashboard renders as a place name, so the guards matter more than the happy
 * path: a header that is absent, malformed, or carries one of the proxy's
 * "unknown" sentinels must produce an empty country rather than a plausible
 * wrong one.
 *
 * `resolveGeo` is exercised without a MaxMind database loaded, which is the
 * exact condition the fallback exists for — `lookupGeo` returns empty, so
 * whatever comes back is the header's doing.
 */

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("countryFromHeaders", () => {
  it("reads Cloudflare's country header", () => {
    expect(countryFromHeaders(headers({ "cf-ipcountry": "GB" }))).toBe("GB");
  });

  it("accepts the other common edge headers", () => {
    expect(countryFromHeaders(headers({ "x-vercel-ip-country": "DE" }))).toBe("DE");
    expect(countryFromHeaders(headers({ "fastly-client-country-code": "JP" }))).toBe("JP");
    expect(countryFromHeaders(headers({ "x-geo-country": "BR" }))).toBe("BR");
  });

  it("normalises case", () => {
    expect(countryFromHeaders(headers({ "cf-ipcountry": "gb" }))).toBe("GB");
  });

  it("returns nothing when no header is present", () => {
    expect(countryFromHeaders(headers({}))).toBe("");
  });

  it.each(["XX", "T1", "ZZ", "AP", "EU", "UNKNOWN"])(
    "treats %s as no country rather than a place",
    (sentinel) => {
      // XX is Cloudflare's "could not determine"; T1 is Tor. Storing either
      // would invent a location the visitor is not in.
      expect(countryFromHeaders(headers({ "cf-ipcountry": sentinel }))).toBe("");
    },
  );

  it.each(["GBR", "G", "", "12", "G1", "United Kingdom", "gb-en"])(
    "rejects %j as not an ISO alpha-2 code",
    (malformed) => {
      expect(countryFromHeaders(headers({ "cf-ipcountry": malformed }))).toBe("");
    },
  );

  it("does not let a header inject arbitrary text", () => {
    // The value reaches a LowCardinality(String) column and is rendered as a
    // country name, so anything that is not two letters must be dropped.
    expect(countryFromHeaders(headers({ "cf-ipcountry": "<script>" }))).toBe("");
    expect(countryFromHeaders(headers({ "cf-ipcountry": "US; DROP TABLE" }))).toBe("");
  });
});

describe("resolveGeo", () => {
  it("falls back to the header when the database has no answer", () => {
    // No MaxMind database is loaded in this process, so the database lookup
    // returns empty and the header is the only source.
    expect(resolveGeo("1.1.1.1", headers({ "cf-ipcountry": "IE" })).country).toBe("IE");
  });

  it("leaves the other geo fields empty — a header carries only a country", () => {
    const geo = resolveGeo("1.1.1.1", headers({ "cf-ipcountry": "IE" }));
    expect(geo.region).toBe("");
    expect(geo.city).toBe("");
    expect(geo.asn).toBe(0);
  });

  it("returns an empty country when neither source can answer", () => {
    expect(resolveGeo("1.1.1.1", headers({})).country).toBe("");
  });

  it("does not require an IP to use the header", () => {
    // An unattributable address still gets a country if the edge resolved one.
    expect(resolveGeo("", headers({ "cf-ipcountry": "NL" })).country).toBe("NL");
  });
});

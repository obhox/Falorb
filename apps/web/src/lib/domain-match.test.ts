import { describe, expect, it } from "vitest";
import { normaliseHost, ownerOf } from "./domain-match";

/**
 * Attribution has to agree with the collector, or the settings page lies.
 *
 * These cases mirror `originAllowed` in the ingest service: if the collector
 * accepts an event from a host, the domain that authorised it must be the
 * domain this reports as connected. A divergence here does not throw — it
 * quietly labels a working install as "waiting", which is exactly the wrong
 * answer to give someone who just pasted the snippet correctly.
 */

describe("normaliseHost", () => {
  it("lowercases and drops a leading www., as the collector does", () => {
    expect(normaliseHost("WWW.Evyos.com")).toBe("evyos.com");
    expect(normaliseHost("  evyos.com ")).toBe("evyos.com");
  });

  it("leaves an inner www alone", () => {
    // Only the leading label is a convention; `www.internal.x.com` is a real
    // distinct host and truncating it would merge two different sites.
    expect(normaliseHost("app.www.evyos.com")).toBe("app.www.evyos.com");
  });
});

describe("ownerOf", () => {
  it("matches a configured domain exactly", () => {
    expect(ownerOf("evyos.com", ["evyos.com"])).toBe("evyos.com");
  });

  it("matches regardless of www on either side", () => {
    expect(ownerOf("www.evyos.com", ["evyos.com"])).toBe("evyos.com");
    expect(ownerOf("evyos.com", ["www.evyos.com"])).toBe("www.evyos.com");
  });

  it("folds a subdomain into a configured apex", () => {
    // The collector accepts this, so the dashboard must attribute it rather
    // than report the apex as never having received anything.
    expect(ownerOf("app.evyos.com", ["evyos.com"])).toBe("evyos.com");
    expect(ownerOf("deep.staging.evyos.com", ["evyos.com"])).toBe("evyos.com");
  });

  it("prefers the most specific configured domain", () => {
    // Both are configured, so the subdomain's own row must own its traffic —
    // otherwise adding it to the list makes it look permanently uninstalled.
    expect(ownerOf("app.evyos.com", ["evyos.com", "app.evyos.com"])).toBe("app.evyos.com");
    expect(ownerOf("app.evyos.com", ["app.evyos.com", "evyos.com"])).toBe("app.evyos.com");
    expect(ownerOf("blog.evyos.com", ["evyos.com", "app.evyos.com"])).toBe("evyos.com");
  });

  it("returns the domain as configured, not as normalised", () => {
    // The caller looks its own list up by this value, and renders it.
    expect(ownerOf("evyos.com", ["WWW.Evyos.com"])).toBe("WWW.Evyos.com");
  });

  it("does not match a domain that merely ends with the same letters", () => {
    // `notevyos.com` is a different site. A naive endsWith would claim it.
    expect(ownerOf("notevyos.com", ["evyos.com"])).toBeNull();
    expect(ownerOf("evyos.com.attacker.test", ["evyos.com"])).toBeNull();
  });

  it("matches nothing when nothing is configured", () => {
    expect(ownerOf("evyos.com", [])).toBeNull();
    expect(ownerOf("", ["evyos.com"])).toBeNull();
    expect(ownerOf("evyos.com", ["", "  "])).toBeNull();
  });
});

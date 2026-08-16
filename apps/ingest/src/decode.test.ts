import { describe, expect, it } from "vitest";
import type { WireBatch } from "@falorb/core";
import { clampTimestamp, decodeBatch } from "./decode";
import type { CachedProject } from "./projects";
import { originAllowed } from "./projects";

const project: CachedProject = {
  id: 1,
  organizationId: "org-1",
  publicKey: "prj_test",
  domains: ["obhox.com", "linkbry.com"],
  consentMode: "off",
  cookieless: false,
  identityScope: "org",
  timezone: "UTC",
  archived: false,
  settings: {},
};

const NOW = 1_800_000_000_000;

function ctx(overrides: Partial<Parameters<typeof decodeBatch>[1]> = {}) {
  return {
    project,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ip: "203.0.113.9",
    geo: { country: "NG", region: "Lagos", city: "Lagos", asn: 12345, asnOrg: "Example ISP" },
    saltSecret: "test-secret-at-least-16-chars-long",
    receivedAt: NOW,
    ...overrides,
  };
}

function batch(events: WireBatch["e"], extra: Partial<WireBatch> = {}): WireBatch {
  return { k: "prj_test", d: "dev-1", s: "ses-1", e: events, ...extra };
}

describe("decodeBatch", () => {
  it("maps a pageview into canonical columns", () => {
    const [e] = decodeBatch(
      batch([{ n: "$pageview", t: NOW - 1000, u: "https://obhox.com/Blog/Post/?a=1", ti: "Post" }]),
      ctx(),
    );
    expect(e!.name).toBe("$pageview");
    expect(e!.path).toBe("/blog/post");
    expect(e!.host).toBe("obhox.com");
    expect(e!.browser).toBe("Chrome");
    expect(e!.deviceType).toBe("desktop");
    expect(e!.country).toBe("NG");
    expect(e!.isBot).toBe(false);
  });

  it("classifies acquisition from the referrer", () => {
    const [e] = decodeBatch(
      batch([{ n: "$pageview", t: NOW, u: "https://obhox.com/", r: "https://www.google.com/" }]),
      ctx(),
    );
    expect(e!.channel).toBe("organic_search");
    expect(e!.source).toBe("Google");
  });

  it("treats a sibling project domain as internal traffic", () => {
    const [e] = decodeBatch(
      batch([{ n: "$pageview", t: NOW, u: "https://obhox.com/", r: "https://linkbry.com/" }]),
      ctx(),
    );
    expect(e!.channel).toBe("internal");
  });

  it("splits properties into typed maps", () => {
    const [e] = decodeBatch(
      batch([
        {
          n: "checkout",
          t: NOW,
          u: "https://obhox.com/buy",
          p: { plan: "pro", seats: 3, trial: true },
        },
      ]),
      ctx(),
    );
    expect(e!.propsStr).toEqual({ plan: "pro", trial: "true" });
    expect(e!.propsNum).toEqual({ seats: 3 });
    expect(JSON.parse(e!.propsRaw)).toEqual({ plan: "pro", seats: 3, trial: true });
  });

  it("gives every event in a batch the same person and session", () => {
    const events = decodeBatch(
      batch([
        { n: "$pageview", t: NOW - 200, u: "https://obhox.com/" },
        { n: "$pageview", t: NOW - 100, u: "https://obhox.com/pricing" },
      ]),
      ctx(),
    );
    expect(events[0]!.personId).toBe(events[1]!.personId);
    expect(events[0]!.sessionId).toBe(events[1]!.sessionId);
  });

  it("flags bot traffic so it can be excluded from visitor metrics", () => {
    const [e] = decodeBatch(
      batch([{ n: "$pageview", t: NOW, u: "https://obhox.com/" }]),
      ctx({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }),
    );
    expect(e!.isBot).toBe(true);
    expect(e!.botName).toBe("Googlebot");
  });

  it("carries the identified id on $identify for the resolver", () => {
    const [e] = decodeBatch(
      batch([{ n: "$identify", t: NOW, u: "https://obhox.com/app" }], { i: "user_42" }),
      ctx(),
    );
    expect(e!.propsStr.identified_id).toBe("user_42");
    // distinct_id stays the device, never the user id.
    expect(e!.distinctId).toBe("dev-1");
  });

  it("never carries a raw IP into the event", () => {
    const [e] = decodeBatch(batch([{ n: "$pageview", t: NOW, u: "https://obhox.com/" }]), ctx());
    expect(JSON.stringify(e)).not.toContain("203.0.113.9");
    expect(e!.ipHash).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("clampTimestamp", () => {
  it("keeps a plausible client timestamp", () => {
    expect(clampTimestamp(NOW - 5000, NOW)).toBe(NOW - 5000);
  });

  it("replaces a wildly wrong device clock with server time", () => {
    expect(clampTimestamp(1_000_000_000_000, NOW)).toBe(NOW);
  });

  it("never accepts a future timestamp", () => {
    expect(clampTimestamp(NOW + 5000, NOW)).toBe(NOW);
  });
});

describe("originAllowed", () => {
  it("accepts a configured domain", () => {
    expect(originAllowed(project, "https://obhox.com")).toBe(true);
  });

  it("accepts a subdomain of a configured domain", () => {
    expect(originAllowed(project, "https://app.obhox.com")).toBe(true);
  });

  it("rejects an unrelated origin, so a leaked public key cannot poison data", () => {
    expect(originAllowed(project, "https://evil.example")).toBe(false);
  });

  it("accepts requests with no Origin, for server-side SDK use", () => {
    expect(originAllowed(project, null)).toBe(true);
  });

  it("accepts any origin when no domains are configured yet", () => {
    expect(originAllowed({ ...project, domains: [] }, "https://anything.example")).toBe(true);
  });
});

describe("PII masking", () => {
  const masked = (settings: unknown, event: Parameters<typeof batch>[0][number]) =>
    decodeBatch(batch([event]), ctx({ project: { ...project, settings } }))[0]!;

  it("strips sensitive query parameters from the stored URL by default", () => {
    const e = masked({}, {
      n: "$pageview",
      t: NOW,
      u: "https://obhox.com/welcome?email=ada@example.com&token=abc123&page=2",
    });
    expect(e.url).not.toContain("ada@example.com");
    expect(e.url).not.toContain("abc123");
    // Non-sensitive parameters survive — masking must not destroy the analytics.
    expect(e.url).toContain("page=2");
  });

  it("scrubs an email that appears under an innocent parameter name", () => {
    const e = masked({}, {
      n: "$pageview",
      t: NOW,
      u: "https://obhox.com/?ref=ada@example.com",
    });
    expect(e.url).not.toContain("ada@example.com");
    expect(e.url).toContain("redacted");
  });

  it("scrubs PII from the page title", () => {
    const e = masked({}, {
      n: "$pageview",
      t: NOW,
      u: "https://obhox.com/order",
      ti: "Order for ada@example.com",
    });
    expect(e.title).not.toContain("ada@example.com");
  });

  it("masks the referrer, which carries the previous page's query string", () => {
    const e = masked({}, {
      n: "$pageview",
      t: NOW,
      u: "https://obhox.com/",
      r: "https://partner.example/landing?email=ada@example.com",
    });
    expect(e.referrer).not.toContain("ada@example.com");
  });

  it("redacts configured property keys", () => {
    const e = masked({ masking: { redactProps: ["customer_email"] } }, {
      n: "signup",
      t: NOW,
      u: "https://obhox.com/",
      p: { customer_email: "ada@example.com", plan: "pro" },
    });
    expect(e.propsStr.customer_email).toBe("[redacted]");
    expect(e.propsStr.plan).toBe("pro");
  });

  it("masks props_raw too, not just the flattened maps", () => {
    // props_raw is what the event detail view shows verbatim; leaving it
    // unmasked would defeat the whole feature.
    const e = masked({ masking: { redactProps: ["customer_email"] } }, {
      n: "signup",
      t: NOW,
      u: "https://obhox.com/",
      p: { customer_email: "ada@example.com" },
    });
    expect(e.propsRaw).not.toContain("ada@example.com");
  });

  it("normalises id path segments only when enabled", () => {
    const off = masked({}, { n: "$pageview", t: NOW, u: "https://obhox.com/orders/8412" });
    expect(off.path).toBe("/orders/8412");

    const on = masked({ masking: { normalizeIds: true } }, {
      n: "$pageview",
      t: NOW,
      u: "https://obhox.com/orders/8412",
    });
    expect(on.path).toBe("/orders/:id");
  });

  it("leaves a long numeric id out of free text only above the digit threshold", () => {
    const e = masked({}, {
      n: "checkout",
      t: NOW,
      u: "https://obhox.com/",
      p: { sku: "SKU-4821", card: "4111111111111111" },
    });
    // Short product codes must survive; a 16-digit number must not.
    expect(e.propsStr.sku).toBe("SKU-4821");
    expect(e.propsStr.card).toBe("[redacted]");
  });
});

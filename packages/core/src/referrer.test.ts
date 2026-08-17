import { describe, expect, it } from "vitest";
import { classifyReferrer } from "./referrer";
import { parseUtm } from "./url";

const noUtm = parseUtm(undefined);

function classify(referrer: string | undefined, url?: string, selfHost = "acme.example") {
  return classifyReferrer({ referrer, utm: parseUtm(url), selfHost });
}

describe("classifyReferrer", () => {
  it("treats a missing referrer with no UTM as direct", () => {
    const r = classify(undefined);
    expect(r.channel).toBe("direct");
    expect(r.source).toBe("Direct");
  });

  it("classifies Google as organic search", () => {
    const r = classify("https://www.google.com/");
    expect(r.channel).toBe("organic_search");
    expect(r.source).toBe("Google");
    expect(r.referrerHost).toBe("google.com");
  });

  it("resolves a country-specific search domain via its multi-part TLD", () => {
    expect(classify("https://www.google.co.uk/search").source).toBe("Google");
  });

  it("classifies LLM assistants as search rather than referral", () => {
    expect(classify("https://chatgpt.com/").source).toBe("ChatGPT");
    expect(classify("https://www.perplexity.ai/").channel).toBe("organic_search");
  });

  it("classifies Hacker News from its subdomain-style key", () => {
    const r = classify("https://news.ycombinator.com/item?id=1");
    expect(r.source).toBe("Hacker News");
    expect(r.channel).toBe("organic_social");
  });

  it("distinguishes t.co from t.me", () => {
    expect(classify("https://t.co/abc").source).toBe("X");
    expect(classify("https://t.me/somechannel").source).toBe("Telegram");
  });

  it("classifies an unknown host as referral under its own name", () => {
    const r = classify("https://someblog.dev/post");
    expect(r.channel).toBe("referral");
    expect(r.source).toBe("someblog.dev");
  });

  it("marks same-host navigation as internal", () => {
    expect(classify("https://acme.example/about").channel).toBe("internal");
  });

  it("marks a sibling project domain as internal", () => {
    const r = classifyReferrer({
      referrer: "https://beacon.example/",
      utm: noUtm,
      selfHost: "acme.example",
      ownHosts: ["beacon.example", "notewell.example"],
    });
    expect(r.channel).toBe("internal");
  });

  it("recognises webmail referrers as email", () => {
    expect(classify("https://mail.google.com/mail/u/0").channel).toBe("email");
  });

  describe("UTM precedence", () => {
    it("lets utm_medium=cpc override an organic referrer", () => {
      const r = classify(
        "https://www.google.com/",
        "https://acme.example/?utm_source=google&utm_medium=cpc",
      );
      expect(r.channel).toBe("paid_search");
    });

    it("routes paid traffic from a social source to paid_social", () => {
      const r = classify(
        undefined,
        "https://acme.example/?utm_source=facebook&utm_medium=cpc",
      );
      expect(r.channel).toBe("paid_social");
      expect(r.source).toBe("Facebook");
    });

    it("classifies newsletter medium as email", () => {
      const r = classify(undefined, "https://acme.example/?utm_medium=newsletter&utm_source=beehiiv");
      expect(r.channel).toBe("email");
      expect(r.source).toBe("Beehiiv");
    });

    it("uses a bare utm_source when there is no referrer", () => {
      const r = classify(undefined, "https://acme.example/?utm_source=partnersite");
      expect(r.channel).toBe("referral");
      expect(r.source).toBe("Partnersite");
    });
  });
});

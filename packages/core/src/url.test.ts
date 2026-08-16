import { describe, expect, it } from "vitest";
import { isDownloadUrl, normalizePath, parseUrl, parseUtm } from "./url";

describe("normalizePath", () => {
  it("lowercases and strips a trailing slash", () => {
    expect(normalizePath("/Blog/Post/")).toBe("/blog/post");
  });

  it("keeps the root path intact", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("collapses duplicate separators", () => {
    expect(normalizePath("/a//b///c")).toBe("/a/b/c");
  });
});

describe("parseUrl", () => {
  it("splits a URL into its parts and drops the www prefix", () => {
    const r = parseUrl("https://www.obhox.com/Blog/Post/?a=1#top");
    expect(r.host).toBe("obhox.com");
    expect(r.path).toBe("/blog/post");
    expect(r.query).toBe("a=1");
    expect(r.hash).toBe("top");
  });

  it("strips ad-click noise parameters but keeps real ones", () => {
    const r = parseUrl("https://obhox.com/?fbclid=xyz&gclid=abc&page=2");
    expect(r.url).not.toContain("fbclid");
    expect(r.url).not.toContain("gclid");
    expect(r.url).toContain("page=2");
  });

  it("does not throw on a malformed URL", () => {
    const r = parseUrl("not a url");
    expect(r.host).toBe("");
    expect(r.path).toBe("");
  });

  it("returns empty parts for undefined", () => {
    expect(parseUrl(undefined).url).toBe("");
  });
});

describe("parseUtm", () => {
  it("extracts and lowercases the standard parameters", () => {
    const r = parseUtm(
      "https://obhox.com/?utm_source=Google&utm_medium=CPC&utm_campaign=Launch",
    );
    expect(r).toMatchObject({ source: "google", medium: "cpc", campaign: "launch" });
  });

  it("accepts the Plausible-style ref alias", () => {
    expect(parseUtm("https://obhox.com/?ref=producthunt").source).toBe("producthunt");
  });

  it("returns empty strings when nothing is tagged", () => {
    expect(parseUtm("https://obhox.com/")).toEqual({
      source: "",
      medium: "",
      campaign: "",
      term: "",
      content: "",
    });
  });
});

describe("isDownloadUrl", () => {
  it("detects common download extensions", () => {
    expect(isDownloadUrl("https://obhox.com/files/guide.pdf")).toBe(true);
    expect(isDownloadUrl("https://obhox.com/app.dmg")).toBe(true);
  });

  it("does not treat an ordinary page as a download", () => {
    expect(isDownloadUrl("https://obhox.com/blog/post")).toBe(false);
  });
});

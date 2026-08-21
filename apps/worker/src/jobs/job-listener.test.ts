import { describe, expect, it } from "vitest";
import { hashUrl } from "./job-listener";

describe("hashUrl", () => {
  it("is deterministic for the same URL", () => {
    const url = "https://www.linkedin.com/jobs/view/12345";
    expect(hashUrl(url)).toBe(hashUrl(url));
  });

  it("differs between distinct URLs", () => {
    expect(hashUrl("https://indeed.com/a")).not.toBe(hashUrl("https://indeed.com/b"));
  });

  it("returns a short hex string", () => {
    expect(hashUrl("https://lever.co/x")).toMatch(/^[0-9a-f]{24}$/);
  });
});

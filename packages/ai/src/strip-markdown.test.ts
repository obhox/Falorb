import { describe, expect, it } from "vitest";
import { stripMarkdown } from "./strip-markdown";

/**
 * Callers render generated text as plain text, no markdown renderer — so
 * unstripped syntax shows up as literal asterisks and hashes on screen. The
 * prompt instructs the model against markdown, but that alone isn't
 * reliable, hence this second, guaranteed pass.
 */
describe("stripMarkdown", () => {
  it("removes bold emphasis", () => {
    expect(stripMarkdown("**Contact Lead #1 first**")).toBe("Contact Lead #1 first");
  });

  it("removes italic emphasis without touching bold", () => {
    expect(stripMarkdown("*emphasis*")).toBe("emphasis");
    expect(stripMarkdown("**bold** and *italic*")).toBe("bold and italic");
  });

  it("removes heading markers", () => {
    expect(stripMarkdown("# Outreach Prioritization Recommendation")).toBe(
      "Outreach Prioritization Recommendation",
    );
    expect(stripMarkdown("## A subheading")).toBe("A subheading");
  });

  it("removes bullet and numbered list markers", () => {
    expect(stripMarkdown("- first point")).toBe("first point");
    expect(stripMarkdown("* first point")).toBe("first point");
    expect(stripMarkdown("1. first point")).toBe("first point");
  });

  it("leaves plain prose untouched", () => {
    const plain = "Organic search is your best channel this month. Cut paid search.";
    expect(stripMarkdown(plain)).toBe(plain);
  });

  it("does not mangle snake_case field names quoted from real data", () => {
    expect(stripMarkdown("the utm_source field")).toBe("the utm_source field");
    expect(stripMarkdown("check utm_source and utm_medium together")).toBe(
      "check utm_source and utm_medium together",
    );
  });
});

import { describe, expect, it } from "vitest";
import { parseClayResponse } from "./clay-enrichment";

describe("parseClayResponse", () => {
  it("maps a full match", () => {
    expect(
      parseClayResponse({
        name: "Ada Lovelace",
        email: "ada@example.com",
        title: "Engineer",
        linkedin_url: "https://linkedin.com/in/ada",
        company_domain: "example.com",
      }),
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      title: "Engineer",
      linkedinUrl: "https://linkedin.com/in/ada",
      companyDomain: "example.com",
    });
  });

  it("treats a response with neither email nor LinkedIn as no match", () => {
    expect(parseClayResponse({ name: "Someone", title: "CEO" })).toBeNull();
  });

  it("accepts a LinkedIn-only match", () => {
    expect(parseClayResponse({ linkedin_url: "https://linkedin.com/in/x" })).not.toBeNull();
  });
});

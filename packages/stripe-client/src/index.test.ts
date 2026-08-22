import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { describeFailure, monthlyEquivalent } from "./index";

describe("monthlyEquivalent", () => {
  it("passes a monthly amount through unchanged", () => {
    expect(monthlyEquivalent(2900, "month", 1)).toBe(2900);
  });

  it("divides a yearly amount by 12", () => {
    expect(monthlyEquivalent(12000, "year", 1)).toBe(1000);
  });

  it("honors a multi-period interval (e.g. every 3 months)", () => {
    expect(monthlyEquivalent(9000, "month", 3)).toBe(3000);
  });

  it("normalizes a weekly amount", () => {
    expect(monthlyEquivalent(1000, "week", 1)).toBeCloseTo((1000 * 52) / 12, 5);
  });

  it("normalizes a daily amount", () => {
    expect(monthlyEquivalent(100, "day", 1)).toBeCloseTo((100 * 365) / 12, 5);
  });

  it("treats an unknown interval as monthly rather than throwing", () => {
    expect(monthlyEquivalent(500, "fortnight", 1)).toBe(500);
  });
});

describe("describeFailure", () => {
  it("flags a bad key distinctly from a generic rejection", () => {
    const message = describeFailure(
      new Stripe.errors.StripeAuthenticationError({ message: "Invalid API Key provided", statusCode: 401 }),
    );
    expect(message).toContain("401");
    expect(message).toContain("secret key");
  });

  it("flags a scope-restricted key", () => {
    const message = describeFailure(
      new Stripe.errors.StripePermissionError({
        message: "This key does not have permission",
        statusCode: 403,
      }),
    );
    expect(message).toContain("403");
    expect(message).toContain("permission");
  });

  it("surfaces rate limiting", () => {
    const message = describeFailure(
      new Stripe.errors.StripeRateLimitError({ message: "Too many requests", statusCode: 429 }),
    );
    expect(message).toContain("429");
  });

  it("falls back to the plain error message for a non-Stripe error", () => {
    expect(describeFailure(new Error("network down"))).toBe("network down");
  });

  it("stringifies a non-Error throw", () => {
    expect(describeFailure("boom")).toBe("boom");
  });
});

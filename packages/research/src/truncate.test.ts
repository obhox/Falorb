import { describe, expect, it } from "vitest";
import { truncateText } from "./truncate";

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("hello world", 100)).toBe("hello world");
  });

  it("trims surrounding whitespace even when under budget", () => {
    expect(truncateText("  hello world  \n", 100)).toBe("hello world");
  });

  it("cuts long text to the budget and appends an ellipsis", () => {
    const result = truncateText("a".repeat(50), 10);
    expect(result).toBe(`${"a".repeat(10)}…`);
  });

  it("trims trailing whitespace left at the cut point", () => {
    const result = truncateText("hello      world", 8);
    expect(result).toBe("hello…");
  });
});

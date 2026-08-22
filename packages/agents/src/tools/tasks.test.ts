import { describe, expect, it } from "vitest";
import { MAX_DELEGATION_DEPTH, checkDelegation } from "./tasks";

describe("checkDelegation", () => {
  it("refuses delegating to yourself", () => {
    expect(checkDelegation(0, "agent-a", "agent-a")).toMatch(/yourself/);
  });

  it("allows a chain up to the depth limit", () => {
    for (let depth = 0; depth < MAX_DELEGATION_DEPTH; depth++) {
      expect(checkDelegation(depth, "agent-a", "agent-b")).toBeNull();
    }
  });

  it("refuses a hop past the depth limit", () => {
    const refusal = checkDelegation(MAX_DELEGATION_DEPTH, "agent-a", "agent-b");
    expect(refusal).toMatch(/hand this to a human/i);
  });
});

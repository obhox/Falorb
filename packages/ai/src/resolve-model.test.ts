import { describe, expect, it } from "vitest";
import { resolveModel } from "./resolve-model";

describe("resolveModel", () => {
  it("defaults to openrouter/auto when unset", () => {
    expect(resolveModel(undefined)).toEqual({ model: "openrouter/auto" });
    expect(resolveModel("")).toEqual({ model: "openrouter/auto" });
  });

  it("pins a single model", () => {
    expect(resolveModel("anthropic/claude-sonnet-4.5")).toEqual({
      model: "anthropic/claude-sonnet-4.5",
    });
  });

  it("turns a comma-separated list into an ordered fallback array", () => {
    expect(resolveModel("anthropic/claude-sonnet-4.5,openai/gpt-4o")).toEqual({
      models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
    });
  });

  it("trims whitespace around each entry", () => {
    expect(resolveModel(" anthropic/claude-sonnet-4.5 , openai/gpt-4o ")).toEqual({
      models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
    });
  });

  it("drops empty entries from stray commas", () => {
    expect(resolveModel("anthropic/claude-sonnet-4.5,,openai/gpt-4o,")).toEqual({
      models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
    });
  });

  it("treats a single entry with a trailing comma as pinning one model, not a list", () => {
    expect(resolveModel("anthropic/claude-sonnet-4.5,")).toEqual({
      model: "anthropic/claude-sonnet-4.5",
    });
  });
});

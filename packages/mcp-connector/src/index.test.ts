import { describe, expect, it } from "vitest";
import { hasToolContent, parseToolResult } from "./index";

describe("hasToolContent", () => {
  it("recognizes a normal tool result", () => {
    expect(hasToolContent({ content: [{ type: "text", text: "hi" }] })).toBe(true);
  });

  it("rejects a task-based result with no content array", () => {
    expect(hasToolContent({ task: { id: "1" } })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(hasToolContent(null)).toBe(false);
    expect(hasToolContent("hi")).toBe(false);
  });
});

describe("parseToolResult", () => {
  it("parses JSON text content", () => {
    expect(parseToolResult({ content: [{ type: "text", text: '{"ok":true}' }] })).toEqual({ ok: true });
  });

  it("falls back to the raw string when the text isn't JSON", () => {
    expect(parseToolResult({ content: [{ type: "text", text: "just a summary" }] })).toBe("just a summary");
  });

  it("falls back to the content array when there's no text part", () => {
    const content = [{ type: "image", text: undefined }];
    expect(parseToolResult({ content })).toBe(content);
  });
});

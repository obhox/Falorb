import { describe, expect, it } from "vitest";
import { rebuildMessages, type ReplayableStep } from "./run";

/**
 * Resume, which only ever happens after a worker dies mid-shift.
 *
 * That makes it the one path normal use never exercises, and a mistake in it
 * surfaces at the worst possible moment — so the invariants are asserted
 * here rather than trusted. The load-bearing one is id pairing: every `tool`
 * message must reference an id declared on a preceding assistant message, or
 * an OpenAI-compatible API rejects the whole request and the resumed run
 * dies on its first turn.
 */

const step = (over: Partial<ReplayableStep> & { position: number; kind: string }): ReplayableStep => ({
  content: null,
  toolName: null,
  toolCallId: null,
  arguments: null,
  result: null,
  ...over,
});

/** A realistic transcript: think, call a tool, get a result, ask permission. */
const transcript: ReplayableStep[] = [
  step({ position: 0, kind: "assistant", content: "Let me look at the numbers." }),
  step({
    position: 1,
    kind: "assistant",
    content: null,
    arguments: {
      toolCalls: [
        { id: "call_abc", name: "get_stats", args: '{"range":"7d"}' },
        { id: "call_def", name: "create_task", args: '{"title":"Fix it"}' },
      ],
    },
  }),
  step({ position: 2, kind: "tool_call", toolName: "get_stats", toolCallId: "call_abc" }),
  step({
    position: 3,
    kind: "tool_result",
    toolName: "get_stats",
    toolCallId: "call_abc",
    result: { visitors: 120 },
  }),
  step({ position: 4, kind: "tool_call", toolName: "create_task", toolCallId: "call_def" }),
  step({
    position: 5,
    kind: "approval",
    toolName: "create_task",
    toolCallId: "call_def",
    result: { status: "awaiting_approval", approvalId: "a1", message: "Do not retry it." },
  }),
];

function assistantIds(messages: ReturnType<typeof rebuildMessages>): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) ids.add(call.id);
    }
  }
  return ids;
}

describe("rebuildMessages", () => {
  it("pairs every tool message with an id declared on an earlier assistant message", () => {
    const messages = rebuildMessages(transcript);
    const declared = assistantIds(messages);
    const referenced = messages.filter((m) => m.role === "tool");

    expect(referenced.length).toBeGreaterThan(0);
    for (const message of referenced) {
      expect(declared).toContain((message as { toolCallId: string }).toolCallId);
    }
  });

  it("does not emit a second copy of each call from the tool_call rows", () => {
    const messages = rebuildMessages(transcript);
    // Two assistant messages, two tool messages — the tool_call rows are the
    // human-readable record and are already inside the assistant message.
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(2);
    expect(messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("replays an approval as the full instruction, not just its id", () => {
    const messages = rebuildMessages(transcript);
    const approval = messages.find(
      (m) => m.role === "tool" && (m as { name: string }).name === "create_task",
    );
    // Without this the resumed run loses the "do not retry" instruction and
    // queues the same approval a second time.
    expect((approval as { content: string }).content).toContain("Do not retry it.");
    expect((approval as { content: string }).content).toContain("awaiting_approval");
  });

  it("keeps assistant prose that carried no tool calls", () => {
    const messages = rebuildMessages(transcript);
    expect(messages[0]).toMatchObject({ role: "assistant", content: "Let me look at the numbers." });
    expect((messages[0] as { toolCalls?: unknown }).toolCalls).toBeUndefined();
  });

  it("still pairs ids for a transcript written before ids were persisted", () => {
    const legacy: ReplayableStep[] = [
      step({
        position: 0,
        kind: "assistant",
        arguments: { toolCalls: [{ name: "get_stats", args: "{}" }] },
      }),
      // The old rows carried no `toolCallId` either, so both sides fall back
      // to the same synthesised value rather than half-matching.
      step({ position: 1, kind: "tool_result", toolName: "get_stats", result: { ok: true } }),
    ];
    const messages = rebuildMessages(legacy);
    const declared = assistantIds(messages);
    const tool = messages.find((m) => m.role === "tool") as { toolCallId: string };
    expect(declared.has(tool.toolCallId)).toBe(true);
  });

  it("returns nothing for an empty transcript", () => {
    expect(rebuildMessages([])).toEqual([]);
  });
});

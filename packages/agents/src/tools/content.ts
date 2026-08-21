import { z } from "zod";
import { complete, PLAIN_TEXT_INSTRUCTION } from "@falorb/ai";
import type { AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * Writing, as a step inside a larger job.
 *
 * An agent can obviously write prose in its own reply — so a "draft text"
 * tool looks redundant until you notice what it is actually for: producing a
 * piece of text as *data*, to be attached to a task or queued for approval,
 * without that text becoming part of the agent's own reasoning transcript.
 * A drafted email that lands in the conversation gets treated by the next
 * turn as something the agent said, and gets reasoned over, revised, and
 * half-remembered. One that comes back as a tool result stays an artefact.
 *
 * Nothing here sends anything. Drafting is `internal`; delivery is a
 * different tool in a different toolkit, with a different effect grade.
 */

export const contentTools: AnyToolDefinition[] = [
  defineTool({
    name: "draft_text",
    toolkit: "content",
    description:
      "Write a self-contained piece of text — an outreach email, a summary, a bug report, a " +
      "post — from a brief and whatever context you pass in. Returns the draft. It is not " +
      "sent or published anywhere; attach it to a task or propose it for approval.",
    input: z.object({
      kind: z
        .enum(["email", "summary", "brief", "social_post", "bug_report", "note"])
        .describe("Shapes the tone and length."),
      instruction: z.string().min(5).max(2000).describe("What this should say and to whom."),
      context: z
        .string()
        .max(8000)
        .optional()
        .describe("Facts to write from — pass the actual data, not a description of it."),
      maxWords: z.number().int().min(20).max(800).default(180),
    }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Draft ${a.kind.replace("_", " ")}`,
    execute: async (ctx, a) => {
      const system =
        `You are drafting a ${a.kind.replace("_", " ")} on behalf of a small business. ` +
        `Keep it under ${a.maxWords} words. Be concrete and specific to the facts given; ` +
        "never invent a number, a name, or an event that is not in the context. " +
        "If the context is too thin to write honestly, say so in one sentence instead of " +
        "padding it out." +
        (a.kind === "social_post" || a.kind === "email" ? PLAIN_TEXT_INSTRUCTION : "");

      const text = await complete(
        system,
        { instruction: a.instruction, context: a.context ?? "(none supplied)" },
        {
          maxTokens: Math.min(2000, a.maxWords * 6),
          stripMarkdown: a.kind !== "brief",
          credentials: ctx.credentials,
        },
      );
      return { draft: text };
    },
  }),
];

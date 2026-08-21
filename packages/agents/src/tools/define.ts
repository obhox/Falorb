import type { z } from "zod";
import type {
  AgentContext,
  AnyToolDefinition,
  Capability,
  ToolEffect,
  ToolRisk,
  Toolkit,
} from "../types";

/**
 * Declare a tool with its argument type inferred from its schema.
 *
 * The registry has to hold tools of differing argument types in one array,
 * which erases those types at the boundary. Doing that erasure here, once,
 * means every `execute` and `summarize` below is still written against a
 * precise argument type — the alternative is thirty call sites each casting
 * `unknown`, which is exactly where a renamed field stops being a compile
 * error and starts being a runtime one.
 */
export function defineTool<S extends z.ZodTypeAny>(def: {
  name: string;
  toolkit: Toolkit;
  description: string;
  input: S;
  capability: Capability;
  effect: ToolEffect;
  risk: ToolRisk;
  summarize: (args: z.infer<S>) => string;
  execute: (ctx: AgentContext, args: z.infer<S>) => Promise<unknown>;
}): AnyToolDefinition {
  return def as unknown as AnyToolDefinition;
}

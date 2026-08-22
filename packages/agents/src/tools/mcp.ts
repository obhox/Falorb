import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@falorb/db";
import { McpConnectorError } from "@falorb/mcp-connector";
import { getMcpConnection, listMcpConnections, mcpClientFor } from "../clients";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * Calling tools on an MCP server the organization has connected — the
 * agent-facing half of `@falorb/mcp-connector` (see `apps/mcp/src/tools/
 * mcp-connections.ts` for the other half: connecting/testing/revoking a
 * server, local-operator only, same shape as every other integration).
 *
 * Unlike every other toolkit, this one does not have a fixed set of known
 * actions — a connected server's tools are arbitrary and discovered live.
 * That is why there are exactly two tools here rather than one per remote
 * capability: `@falorb/agents`'s tool registry has to stay one static, global
 * list forever, because `executeApproval` (`run.ts`) resumes a queued
 * approval by looking a tool up **by name** from it, potentially long after
 * the shift that raised it has ended. A tool synthesized fresh per remote
 * server, per shift, would not exist for that lookup to find. `list_mcp_tools`
 * (read) is how an agent learns what is actually callable and with what
 * argument shape — the model's substitute for per-tool function schemas —
 * and `call_mcp_tool` (external) is the one, always-resolvable path every
 * remote call goes through, reconstructing the connection and the real tool
 * name from the ids it stores rather than from any in-memory state.
 *
 * Every call graded `external`, uniformly, regardless of what the remote
 * tool actually does: Falorb has no way to know whether a given server's
 * tool reads or deletes something, so it cannot grade more finely than "this
 * leaves the building" — the same default a human reviewer would want if
 * they can't see inside the box either. An admin who trusts a specific
 * server can waive that with `autoApproveTools: ["toolkit:mcp"]` (or the
 * blanket `"*"`) exactly like any other toolkit.
 */

const STALE_AFTER_MS = 10 * 60 * 1000;

async function toolsFor(ctx: AgentContext, row: typeof schema.mcpConnections.$inferSelect) {
  const stale =
    !row.toolsCache || !row.toolsCachedAt || Date.now() - row.toolsCachedAt.getTime() > STALE_AFTER_MS;
  if (!stale) return row.toolsCache!;

  const client = mcpClientFor(row);
  try {
    const tools = await client.listTools();
    await ctx.db
      .update(schema.mcpConnections)
      .set({ toolsCache: tools, toolsCachedAt: new Date(), status: "active", lastError: null })
      .where(eq(schema.mcpConnections.id, row.id));
    return tools;
  } catch (error) {
    // A stale-but-present cache is more useful to the model than nothing —
    // only surface the failure if there was never a cache to fall back on.
    if (row.toolsCache) return row.toolsCache;
    throw error;
  } finally {
    await client.close();
  }
}

export const mcpTools: AnyToolDefinition[] = [
  defineTool({
    name: "list_mcp_tools",
    toolkit: "mcp",
    description:
      "The MCP servers your organization has connected, and every tool each one currently " +
      "advertises — its name, description, and argument schema. Call this before call_mcp_tool " +
      "to find the exact tool name and argument shape to use; guessing either is a wasted call.",
    input: z.object({
      server: z.string().optional().describe("Limit to one server, by its connected name."),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => (a.server ? `List MCP tools on ${a.server}` : "List MCP tools"),
    execute: async (ctx, a) => {
      const rows = await listMcpConnections(ctx.db, ctx.organizationId);
      const matched = a.server ? rows.filter((r) => r.name === a.server) : rows;
      if (a.server && matched.length === 0) {
        throw new Error(
          `No connected MCP server named "${a.server}". Connected servers: ` +
            (rows.map((r) => r.name).join(", ") || "(none)"),
        );
      }
      const servers = await Promise.all(
        matched.map(async (row) => ({
          connectionId: row.id,
          name: row.name,
          tools: await toolsFor(ctx, row).catch((error) => ({
            error: error instanceof Error ? error.message : String(error),
          })),
        })),
      );
      return { servers };
    },
  }),

  defineTool({
    name: "call_mcp_tool",
    toolkit: "mcp",
    description:
      "Call one tool on a connected MCP server. Use list_mcp_tools first to find the connection " +
      "id, the exact tool name, and its argument shape — this call is rejected if the tool name " +
      "or arguments don't match what the server actually advertises. Every call here reaches " +
      "outside Falorb, so it is graded external regardless of what the remote tool does.",
    input: z.object({
      connectionId: z.string().uuid().describe("From list_mcp_tools."),
      tool: z.string().describe("The exact tool name, as returned by list_mcp_tools."),
      arguments: z.record(z.unknown()).default({}),
    }),
    capability: "actOnIntegrations",
    effect: "external",
    risk: "medium",
    summarize: (a) => `Call \`${a.tool}\` on a connected MCP server`,
    execute: async (ctx, a) => {
      const row = await getMcpConnection(ctx.db, ctx.organizationId, a.connectionId);
      if (!row) throw new Error("No such MCP connection in this workspace.");
      if (row.status === "revoked") throw new Error(`The "${row.name}" MCP connection has been revoked.`);

      const client = mcpClientFor(row);
      try {
        const result = await client.callTool(a.tool, a.arguments);
        return { server: row.name, tool: a.tool, result };
      } catch (error) {
        if (error instanceof McpConnectorError) throw new Error(`${row.name}: ${error.message}`);
        throw error;
      } finally {
        await client.close();
      }
    },
  }),
];

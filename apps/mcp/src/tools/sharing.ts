import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { schema } from "@falorb/db";
import type { McpContext } from "../context";
import { requireCapability, requireScope, resolveProjects } from "../context";
import { failure, text } from "../format";

const TOKEN_BYTES = 32;

function appOrigin(): string {
  return (process.env.FALORB_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Public sharing: one-property share links, on the
 * `dashboards.publicToken` mechanism — same rotate-to-reissue,
 * revoke-survives-the-row semantics as `apps/web/src/server/sharing.ts`.
 */
export function registerSharingTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "get_share_link",
    {
      title: "Get a project's public share link",
      description: "The live public link for a project's summary (and its embeddable badge, at /badge/<token>), or null if not shared.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const [row] = await db
          .select()
          .from(schema.dashboards)
          .where(
            and(
              eq(schema.dashboards.organizationId, scope.organizationId),
              eq(schema.dashboards.projectId, id!),
              isNotNull(schema.dashboards.publicToken),
            ),
          )
          .limit(1);

        if (!row) return text("Not shared. Call create_share_link to create a public link.");

        const origin = appOrigin();
        return text(
          `Share: ${origin}/share/${row.publicToken}\n` + `Badge (embeddable): ${origin}/badge/${row.publicToken}`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_share_link",
    {
      title: "Create or rotate a project's share link",
      description:
        "Mint a public link exposing a project's headline figures and breakdowns (no person-level data) — or rotate the existing one, invalidating the old URL. Requires the write scope.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "share", "create a public link");
        const [id] = resolveProjects(scope, project);
        const row = scope.projects.find((p) => p.id === id)!;

        const token = randomBytes(TOKEN_BYTES).toString("base64url");
        const [existing] = await db
          .select()
          .from(schema.dashboards)
          .where(and(eq(schema.dashboards.organizationId, scope.organizationId), eq(schema.dashboards.projectId, id!)))
          .limit(1);

        if (existing) {
          await db.update(schema.dashboards).set({ publicToken: token, updatedAt: new Date() }).where(eq(schema.dashboards.id, existing.id));
        } else {
          await db.insert(schema.dashboards).values({
            organizationId: scope.organizationId,
            projectId: id!,
            name: `${row.name} — public`,
            publicToken: token,
          });
        }

        return text(`Public link: ${appOrigin()}/share/${token}\nBadge: ${appOrigin()}/badge/${token}`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "revoke_share_link",
    {
      title: "Revoke a project's share link",
      description: "Revoke the public link. The row survives so re-sharing keeps its name. Requires the write scope.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "share", "revoke a public link");
        const [id] = resolveProjects(scope, project);

        const [updated] = await db
          .update(schema.dashboards)
          .set({ publicToken: null, updatedAt: new Date() })
          .where(and(eq(schema.dashboards.organizationId, scope.organizationId), eq(schema.dashboards.projectId, id!)))
          .returning();

        if (!updated) return failure("This project was not shared.");
        return text("Share link revoked.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

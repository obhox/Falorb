import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { schema } from "@falorb/db";
import type { McpContext } from "../context";
import { requireScope, resolveProjects } from "../context";
import { ago, failure, num, table, text } from "../format";

const REFERRAL_BOOST = 3;

function waitlistJoinUrl(token: string): string {
  const origin = (
    process.env.FALORB_WAITLIST_URL ??
    process.env.FALORB_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${origin}/waitlist/${token}`;
}

/**
 * Waitlist / early-access queue. Position is never stored — always computed
 * live from signup order minus a per-referral boost, same as
 * `apps/web/src/server/waitlist.ts`, so it can't drift.
 */
export function registerWaitlistTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_waitlist",
    {
      title: "List waitlist entries",
      description: "Every waitlist signup for a project, ranked by live-computed position (signup order, boosted by referrals).",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const row = scope.projects.find((p) => p.id === id)!;
        const [projectRow] = await db
          .select({ waitlistToken: schema.projects.waitlistToken })
          .from(schema.projects)
          .where(eq(schema.projects.id, id!))
          .limit(1);
        const waitlistToken = projectRow?.waitlistToken ?? null;

        const referralCounts = db
          .select({
            referredByCode: schema.waitlistEntries.referredByCode,
            count: sql<number>`count(*)::int`.as("referral_count"),
          })
          .from(schema.waitlistEntries)
          .where(and(eq(schema.waitlistEntries.projectId, id!), isNotNull(schema.waitlistEntries.referredByCode)))
          .groupBy(schema.waitlistEntries.referredByCode)
          .as("referral_counts");

        const rows = await db
          .select({
            id: schema.waitlistEntries.id,
            email: schema.waitlistEntries.email,
            name: schema.waitlistEntries.name,
            referralCode: schema.waitlistEntries.referralCode,
            createdAt: schema.waitlistEntries.createdAt,
            baseRank: sql<number>`count(*) over (order by ${schema.waitlistEntries.createdAt})::int`,
            referralCount: sql<number>`coalesce(${referralCounts.count}, 0)::int`,
          })
          .from(schema.waitlistEntries)
          .leftJoin(referralCounts, eq(referralCounts.referredByCode, schema.waitlistEntries.referralCode))
          .where(eq(schema.waitlistEntries.projectId, id!));

        const withPositions = rows
          .map((r) => ({
            ...r,
            position: Math.max(1, r.baseRank - REFERRAL_BOOST * r.referralCount),
          }))
          .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());

        return text(
          `**Waitlist — ${row.name}** (${waitlistToken ? "open" : "closed"})\n\n` +
            table(
              withPositions,
              [
                { header: "Position", get: (r) => r.position, align: "right" },
                { header: "Email", get: (r) => r.email },
                { header: "Name", get: (r) => r.name ?? "—" },
                { header: "Referrals", get: (r) => num(r.referralCount), align: "right" },
                { header: "Joined", get: (r) => ago(r.createdAt.toISOString()) },
              ],
              "No signups yet.",
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "enable_waitlist",
    {
      title: "Turn on the waitlist",
      description:
        "Enable the public /waitlist/[token] join page for a project, or rotate its link if already on. Requires the write scope.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);

        const token = randomBytes(32).toString("base64url");
        await db
          .update(schema.projects)
          .set({ waitlistToken: token, updatedAt: new Date() })
          .where(eq(schema.projects.id, id!));

        return text(`Waitlist turned on: ${waitlistJoinUrl(token)}\n\nRotating this again (calling enable_waitlist a second time) invalidates the previous link.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "disable_waitlist",
    {
      title: "Turn off the waitlist",
      description: "Disable the public waitlist join link. Entries survive — this only kills public access. Requires the write scope.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);

        await db
          .update(schema.projects)
          .set({ waitlistToken: null, updatedAt: new Date() })
          .where(eq(schema.projects.id, id!));

        return text("Waitlist turned off. Existing entries are unaffected.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

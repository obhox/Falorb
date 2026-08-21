import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema } from "@falorb/db";
import { RANGE_DESCRIPTION, parseRange, referralClicks } from "@falorb/queries";
import type { McpContext } from "../context";
import { requireScope, resolveProjects } from "../context";
import { failure, num, pct, table, text } from "../format";

const CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;
const INCENTIVE_KINDS = ["discount", "credit", "unlock"] as const;

function referralLinkUrl(code: string): string {
  const origin = (
    process.env.FALORB_REFERRAL_URL ??
    process.env.FALORB_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${origin}/r/${code}`;
}

/**
 * Referral links.
 *
 * `packages/queries` is ClickHouse-only, so — same as
 * `apps/web/src/server/referrals.ts` — the Postgres link inventory and the
 * cross-store join against conversions live here rather than in that
 * package.
 */
export function registerReferralTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_referral_links",
    {
      title: "List referral links",
      description: "Show a project's referral/acquisition links (`/r/<code>`), including revoked ones.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const rows = await db
          .select()
          .from(schema.referralLinks)
          .where(eq(schema.referralLinks.projectId, id!))
          .orderBy(asc(schema.referralLinks.createdAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Code", get: (r) => r.code },
              { header: "Label", get: (r) => r.label },
              { header: "URL", get: (r) => referralLinkUrl(r.code) },
              { header: "Incentive", get: (r) => (r.incentiveKind ? `${r.incentiveKind}: ${r.incentiveValue}` : "—") },
              { header: "Status", get: (r) => (r.revokedAt ? "revoked" : "live") },
            ],
            "No referral links yet — create one with create_referral_link.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_referral_leaderboard",
    {
      title: "Referral link performance",
      description:
        "Clicks, visitors, and conversions (people who went on to identify()) per referral link — which links are actually working.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range }) => {
      const { db, clickhouse, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const parsed = parseRange(range);

        const links = await db
          .select()
          .from(schema.referralLinks)
          .where(eq(schema.referralLinks.projectId, id!))
          .orderBy(asc(schema.referralLinks.createdAt));

        if (!links.length) return text("No referral links configured.");

        const codes = links.map((l) => l.code);
        const [clickRows, converted] = await Promise.all([
          referralClicks(clickhouse, { projectIds: [id!], range: parsed, limit: 500 }),
          db
            .select({ code: schema.persons.firstReferralCode })
            .from(schema.persons)
            .where(and(inArray(schema.persons.firstReferralCode, codes), isNotNull(schema.persons.identifiedId))),
        ]);

        const clicksByCode = new Map(clickRows.map((r) => [r.ref_code, r]));
        const conversionsByCode = new Map<string, number>();
        for (const row of converted) {
          if (!row.code) continue;
          conversionsByCode.set(row.code, (conversionsByCode.get(row.code) ?? 0) + 1);
        }

        const board = links.map((link) => {
          const click = clicksByCode.get(link.code);
          const visitors = click?.visitors ?? 0;
          const conversions = conversionsByCode.get(link.code) ?? 0;
          return {
            label: link.label,
            code: link.code,
            revoked: Boolean(link.revokedAt),
            clicks: click?.clicks ?? 0,
            visitors,
            conversions,
            conversionRate: visitors > 0 ? (conversions / visitors) * 100 : 0,
          };
        });

        return text(
          `**Referral leaderboard — ${parsed.label}**\n\n` +
            table(board, [
              { header: "Link", get: (r) => `${r.label} (${r.code})${r.revoked ? " — revoked" : ""}` },
              { header: "Clicks", get: (r) => num(r.clicks), align: "right" },
              { header: "Visitors", get: (r) => num(r.visitors), align: "right" },
              { header: "Conversions", get: (r) => num(r.conversions), align: "right" },
              { header: "Conv. rate", get: (r) => pct(r.conversionRate), align: "right" },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_referral_link",
    {
      title: "Create a referral link",
      description:
        "Create a `/r/<code>` acquisition link, optionally with an incentive shown to whoever follows it before they're redirected. The code is a public, owner-chosen slug, not a secret. Requires the write scope.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        label: z.string().min(1).describe("What it's for, not the code — e.g. \"Podcast episode 12\"."),
        code: z
          .string()
          .optional()
          .describe("3-64 chars, lowercase letters/numbers/hyphens. Derived from the label if omitted."),
        destination_url: z.string().optional().describe("Full URL to redirect to; defaults to the project's primary domain."),
        incentive_kind: z.enum(INCENTIVE_KINDS).optional(),
        incentive_value: z.string().optional().describe('Short display value, e.g. "20% off". Required if incentive_kind is set.'),
        incentive_description: z.string().optional().describe("Longer copy shown on the interstitial page."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project, label, code, destination_url, incentive_kind, incentive_value, incentive_description }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);

        const finalCode = code || slugify(label);
        if (!CODE_PATTERN.test(finalCode)) {
          return failure("Codes are 3-64 characters, lowercase letters, numbers and hyphens only.");
        }
        if (destination_url) {
          try {
            new URL(destination_url);
          } catch {
            return failure("destination_url must be a full URL, e.g. https://acme.example/launch.");
          }
        }
        if (incentive_kind && !incentive_value) {
          return failure("incentive_value is required when incentive_kind is set.");
        }

        let created: typeof schema.referralLinks.$inferSelect | undefined;
        try {
          [created] = await db
            .insert(schema.referralLinks)
            .values({
              projectId: id!,
              code: finalCode,
              label,
              destinationUrl: destination_url || null,
              incentiveKind: incentive_kind ?? null,
              incentiveValue: incentive_kind ? incentive_value : null,
              incentiveDescription: incentive_kind ? incentive_description || null : null,
            })
            .returning();
        } catch (error) {
          if (error instanceof Error && /unique/i.test(error.message)) {
            return failure(`"${finalCode}" is already in use — pick another code.`);
          }
          throw error;
        }

        return text(`Created referral link **${created!.label}** — ${referralLinkUrl(created!.code)}, id \`${created!.id}\`.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "revoke_referral_link",
    {
      title: "Revoke a referral link",
      description:
        "Soft-revoke a referral link — the row and its historical performance survive, but the link stops being an intended-active one. Requires the write scope.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        link_id: z.string().describe("From list_referral_links."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project, link_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);

        const [revoked] = await db
          .update(schema.referralLinks)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.referralLinks.id, link_id), eq(schema.referralLinks.projectId, id!)))
          .returning();

        if (!revoked) return failure("No such referral link.");
        return text(`Revoked **${revoked.label}**.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

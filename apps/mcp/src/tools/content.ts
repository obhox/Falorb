import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { schema, resolveAiCredentials, type Database } from "@falorb/db";
import { AiSignalError, complete } from "@falorb/ai";
import { contentInterests, parseRange } from "@falorb/queries";
import { OpenSeoApiError } from "@falorb/openseo-client";
import type { McpContext } from "../context";
import { requireScope, resolveProjects } from "../context";
import { resolveOpenSeoClient } from "../integrations";
import { ago, failure, table, text } from "../format";

const BODY_DELIMITER = "---";

/**
 * AI-drafted content pages.
 *
 * `draft_content_page` mirrors `apps/web/src/server/content-draft.ts`
 * exactly (same prompt, same structured-text parsing, same live OpenSEO
 * hook) rather than importing it — that module lives inside the Next.js
 * app, which this server does not depend on. It re-derives the interest
 * context server-side rather than trusting a client-supplied one, same
 * reasoning as the signal regenerators.
 */

/** Best-effort live SEO context — see `seoContext` in `apps/web/src/server/content-draft.ts` for the full reasoning. */
async function seoContext(
  db: Database,
  organizationId: string,
  projectId: number,
  topic: string,
  domain: string | null,
): Promise<string | null> {
  const client = await resolveOpenSeoClient(db, organizationId, projectId);
  if (!client) return null;

  try {
    const [ideas, serp] = await Promise.all([
      client.researchKeywords(topic, { limit: 5 }),
      domain ? client.getSerpResults(topic) : Promise.resolve([]),
    ]);

    const lines: string[] = [];
    const primary = ideas[0];
    if (primary) {
      const cpc = primary.cpc != null ? `, CPC $${primary.cpc}` : "";
      lines.push(
        `Search volume for "${topic}": ~${primary.volume ?? "unknown"}/month, ` +
          `keyword difficulty ${primary.difficulty ?? "unknown"}/100${cpc}.`,
      );
    }
    if (domain && serp.length) {
      const alreadyRanking = serp.some((r) => r.domain === domain || r.url?.includes(domain));
      const topDomains = [...new Set(serp.slice(0, 5).map((r) => r.domain ?? r.url).filter(Boolean))].join(", ");
      lines.push(
        alreadyRanking
          ? `${domain} already ranks in the top results for this term.`
          : `${domain} does not currently rank in the top results; currently ranking: ${topDomains}.`,
      );
    }

    return lines.length ? lines.join(" ") : null;
  } catch (error) {
    if (error instanceof OpenSeoApiError) return null;
    throw error;
  }
}

export function registerContentTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_content_drafts",
    {
      title: "List AI-drafted content pages",
      description: "Past AI-drafted landing/content pages for a project, newest first.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const rows = await db
          .select({
            id: schema.contentDrafts.id,
            topic: schema.contentDrafts.topic,
            title: schema.contentDrafts.title,
            generatedAt: schema.contentDrafts.generatedAt,
            publishStatus: schema.contentDrafts.publishStatus,
          })
          .from(schema.contentDrafts)
          .where(eq(schema.contentDrafts.projectId, id!))
          .orderBy(desc(schema.contentDrafts.generatedAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Topic", get: (r) => r.topic },
              { header: "Title", get: (r) => r.title },
              { header: "Drafted", get: (r) => ago(r.generatedAt.toISOString()) },
              { header: "Published", get: (r) => r.publishStatus },
            ],
            "No drafts yet — see the Content page's \"rising interest, thin coverage\" topics, then call draft_content_page.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_content_draft",
    {
      title: "Read a drafted content page",
      description: "Full title, meta description, and markdown body of one AI-drafted page.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        draft_id: z.string().describe("From list_content_drafts."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, draft_id }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const [row] = await db
          .select()
          .from(schema.contentDrafts)
          .where(and(eq(schema.contentDrafts.id, draft_id), eq(schema.contentDrafts.projectId, id!)))
          .limit(1);

        if (!row) return failure("No such draft.");

        const publishLine =
          row.publishStatus === "published"
            ? `Published: ${row.publishedUrl ?? "yes"}${row.publishCommitSha ? ` (commit ${row.publishCommitSha.slice(0, 7)})` : ""}`
            : row.publishStatus === "failed"
              ? `Publish failed: ${row.publishError ?? "unknown error"}`
              : "Not published yet.";

        return text(
          `# ${row.title}\n\n*${row.metaDescription}*\n\nTopic: \`${row.topic}\` · Drafted ${ago(row.generatedAt.toISOString())} · ${publishLine}\n\n---\n\n${row.body}`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "draft_content_page",
    {
      title: "Draft a content page for a topic",
      description:
        "Generate a title, meta description, and markdown body for a topic real visitors are interested in but that has almost no page serving it yet — a page draft ready to paste into a CMS, not published anywhere by this tool. Find topics with get_breakdown on field=\"prop:content_tag\" or by reviewing pages with high exit rate and thin coverage; the draft is grounded in the last 30 days of visitor-interest data for the topic. Requires the write scope.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        topic: z.string().min(1).describe("The interest-graph topic to write about."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project, topic }) => {
      const { db, clickhouse, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);
        const row = scope.projects.find((p) => p.id === id)!;

        const range = parseRange("30d");
        const interests = await contentInterests(clickhouse, { projectIds: [id!], range, limit: 15 });
        const topicContext = interests.find((r) => r.topic === topic) ?? { topic };
        const seo = await seoContext(db, scope.organizationId, row.id, topic, row.domains[0] ?? null);

        let raw: string;
        try {
          raw = await complete(
            `You are a content strategist writing a new landing/content page for ${row.name}. ` +
              `The topic is "${topic}": visitors are already searching for or landing near this ` +
              "topic but there is almost no content serving it yet on this property, and you are " +
              "closing that gap. You are given the visitor-interest data behind this topic" +
              (seo
                ? ", plus live SEO data (search volume, keyword difficulty, and who currently " +
                  "ranks) — use it to judge how competitive this term is and whether to target it " +
                  "directly or go after a more specific long-tail angle instead"
                : "") +
              ". Write a complete page for it. Respond with EXACTLY this structure and nothing else: a " +
              'first line starting with "TITLE: " followed by the page title (under 60 ' +
              'characters), a second line starting with "META: " followed by a meta description ' +
              `(under 160 characters), then a line containing only "${BODY_DELIMITER}", then the ` +
              "full page body written in markdown (headings, paragraphs, and lists as " +
              "appropriate) — several hundred words, genuinely useful to a visitor interested in " +
              "this topic, not a stub.",
            { topic, projectName: row.name, interestContext: topicContext, ...(seo ? { seo } : {}) },
            {
              maxTokens: 2000,
              stripMarkdown: false,
              credentials: await resolveAiCredentials(db, scope.organizationId, row.id),
            },
          );
        } catch (error) {
          return failure(error instanceof AiSignalError ? error.message : "Could not draft this page.");
        }

        const draft = parseContentDraft(raw, topic);

        const [created] = await db
          .insert(schema.contentDrafts)
          .values({
            organizationId: scope.organizationId,
            projectId: id!,
            topic,
            title: draft.title,
            metaDescription: draft.metaDescription,
            body: draft.body,
          })
          .returning();

        return text(
          `Drafted **${draft.title}** for topic \`${topic}\`, id \`${created!.id}\`.\n\n` +
            `*${draft.metaDescription}*\n\n---\n\n${draft.body}`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function parseContentDraft(raw: string, topic: string): { title: string; metaDescription: string; body: string } {
  const lines = raw.split("\n");
  let title = "";
  let metaDescription = "";
  let bodyStart = -1;

  for (const [i, line] of lines.entries()) {
    const titleMatch = line.match(/^TITLE:\s*(.+)$/i);
    const metaMatch = line.match(/^META:\s*(.+)$/i);
    if (titleMatch?.[1]) {
      title = titleMatch[1].trim();
    } else if (metaMatch?.[1]) {
      metaDescription = metaMatch[1].trim();
    } else if (line.trim() === BODY_DELIMITER) {
      bodyStart = i + 1;
      break;
    }
  }

  const body = (bodyStart === -1 ? lines.slice(2) : lines.slice(bodyStart)).join("\n").trim();

  return {
    title: title || `A guide to ${topic}`,
    metaDescription: metaDescription || `Learn more about ${topic}.`,
    body: body || raw.trim(),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

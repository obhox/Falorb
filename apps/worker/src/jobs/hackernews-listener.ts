import { and, eq, isNull } from "drizzle-orm";
import { schema, type WorkerContext } from "../context";
import type { Watermarks } from "../scheduler";
import { scoreProspectRelevance } from "./prospect-relevance";

/**
 * Social listening on Hacker News, alongside `reddit-listener.ts` and
 * `job-listener.ts` — see `packages/core/src/prospect-sources.ts` for what
 * each source actually is.
 *
 * Uses the Algolia HN Search API (`hn.algolia.com`), which is public and
 * keyless — like `reddit-listener.ts`'s app-only OAuth grant, this needs no
 * per-org credential, and unlike Reddit there isn't even a client id/secret
 * to configure, so this job never soft-disables. Searches both stories and
 * comments in one call (`tags=(story,comment)`), unlike Reddit's public
 * search endpoint which only reaches posts — a deliberate difference in
 * coverage, not an inconsistency to fix.
 */

const WATERMARK = "hackernews-listener";
const REQUEST_TIMEOUT_MS = 8000;
const RESULTS_PER_KEYWORD = 25;
/** Only look at the last week per run — the job runs every 15m, so this is
 * generous overlap for dedup rather than a real backfill window. */
const LOOKBACK_SECONDS = 7 * 86_400;

interface HnHit {
  objectID: string;
  title: string | null;
  story_title: string | null;
  comment_text: string | null;
  story_text: string | null;
  author: string;
  created_at_i: number;
  /** "story" or "comment" — `_tags` also carries "front_page"/"ask_hn" etc.,
   * so this reads the first of the two we searched for. */
  _tags: string[];
}

interface HnSearchResponse {
  hits?: HnHit[];
}

export async function listenHackerNews(
  context: WorkerContext,
  watermarks: Watermarks,
): Promise<number> {
  const keywordRows = await context.db
    .select({
      projectId: schema.prospectKeywords.projectId,
      keyword: schema.prospectKeywords.keyword,
      organizationId: schema.projects.organizationId,
      projectName: schema.projects.name,
      propertySummary: schema.projects.profileSummary,
    })
    .from(schema.prospectKeywords)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.prospectKeywords.projectId))
    .where(and(eq(schema.prospectKeywords.active, true), isNull(schema.projects.archivedAt)));

  if (!keywordRows.length) return 0;

  let discovered = 0;
  for (const row of keywordRows) {
    try {
      discovered += await listenForKeyword(context, row);
    } catch (error) {
      console.error(
        `[hackernews-listener] keyword "${row.keyword}" (project ${row.projectId}) failed:`,
        String(error),
      );
    }
  }

  await watermarks.set(WATERMARK, Date.now());
  if (discovered) console.log(`[hackernews-listener] discovered ${discovered} new prospects`);
  return discovered;
}

async function listenForKeyword(
  context: WorkerContext,
  row: {
    projectId: number;
    keyword: string;
    organizationId: string;
    projectName: string;
    propertySummary: string | null;
  },
): Promise<number> {
  const hits = await searchHackerNews(row.keyword);
  let newCount = 0;

  for (const hit of hits) {
    const isComment = hit._tags.includes("comment");
    const title = (isComment ? hit.story_title : hit.title) ?? "";
    const excerpt = ((isComment ? hit.comment_text : hit.story_text) || title).slice(0, 1000);
    if (!excerpt) continue;

    const [inserted] = await context.db
      .insert(schema.prospects)
      .values({
        organizationId: row.organizationId,
        projectId: row.projectId,
        source: "hackernews",
        sourceId: hit.objectID,
        sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        sourceType: isComment ? "comment" : "post",
        authorHandle: hit.author,
        title: title || null,
        excerpt: stripHtml(excerpt),
        matchedKeywords: [row.keyword],
        postedAt: new Date(hit.created_at_i * 1000),
        raw: hit,
      })
      .onConflictDoNothing({
        target: [schema.prospects.organizationId, schema.prospects.source, schema.prospects.sourceId],
      })
      .returning({ id: schema.prospects.id });

    if (!inserted) continue; // already discovered — dedup hit
    newCount++;

    // A scoring failure must never drop the underlying discovery — the
    // prospect stays with relevanceScore null, still visible on the dashboard.
    try {
      const scored = await scoreProspectRelevance({
        source: "hackernews",
        projectName: row.projectName,
        propertySummary: row.propertySummary,
        keyword: row.keyword,
        title,
        excerpt,
      });
      if (scored) {
        await context.db
          .update(schema.prospects)
          .set({ relevanceScore: scored.score, relevanceRationale: scored.rationale })
          .where(eq(schema.prospects.id, inserted.id));
      }
    } catch (error) {
      console.error(`[hackernews-listener] relevance scoring failed for ${inserted.id}:`, String(error));
    }
  }

  return newCount;
}

/** Algolia's HN mirror returns `comment_text`/`story_text` as raw HTML
 * (`<p>`, `&quot;` etc.) — strip it down to plain text for the excerpt shown
 * on the dashboard and fed to the relevance/outreach prompts. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchHackerNews(keyword: string): Promise<HnHit[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;
    const url =
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(keyword)}` +
      `&tags=(story,comment)&numericFilters=created_at_i%3E${since}&hitsPerPage=${RESULTS_PER_KEYWORD}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Hacker News search failed (${response.status}) for "${keyword}"`);
    }
    const body = (await response.json()) as HnSearchResponse;
    return body.hits ?? [];
  } finally {
    clearTimeout(timer);
  }
}

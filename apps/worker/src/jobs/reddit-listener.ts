import { and, eq, isNull } from "drizzle-orm";
import { resolveAiCredentials } from "@falorb/db";
import { schema, type WorkerContext } from "../context";
import type { Watermarks } from "../scheduler";
import { scoreProspectRelevance } from "./prospect-relevance";

/**
 * Social listening, one of three sources alongside `hackernews-listener.ts`
 * and `job-listener.ts` — see `packages/core/src/prospect-sources.ts` for
 * what each source actually is.
 *
 * Needs no per-org OAuth: Reddit's public search API is reachable with a
 * single app-only client-credentials grant, so — like `IPINFO_TOKEN` in
 * enrichment.ts — this is one platform-wide credential, not part of the
 * per-org `integrations` table. Only contact enrichment (clay-enrichment.ts)
 * and web-research-backed listening (job-listener.ts, property-profiler.ts)
 * are genuinely per-organization.
 *
 * Scoped to submissions only for now: Reddit's public search endpoint
 * searches posts, not comments — comment-level listening would need a
 * different endpoint and is a deliberate gap, not an oversight.
 */

const WATERMARK = "reddit-listener";
const REQUEST_TIMEOUT_MS = 8000;
const RESULTS_PER_KEYWORD = 25;
const USER_AGENT = "falorb-prospecting/1.0 (social listening; by /u/falorb)";

interface RedditToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: RedditToken | null = null;

interface RedditPostData {
  name: string;
  permalink: string;
  title: string;
  selftext: string;
  author: string;
  created_utc: number;
}

interface RedditSearchResponse {
  data?: { children?: Array<{ data: RedditPostData }> };
}

export async function listenReddit(
  context: WorkerContext,
  watermarks: Watermarks,
): Promise<number> {
  const clientId = process.env.REDDIT_CLIENT_ID ?? "";
  const clientSecret = process.env.REDDIT_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) return 0;

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

  let token: string;
  try {
    token = await getAccessToken(clientId, clientSecret);
  } catch (error) {
    console.error("[reddit-listener] could not obtain access token:", String(error));
    return 0;
  }

  let discovered = 0;
  for (const row of keywordRows) {
    try {
      discovered += await listenForKeyword(context, token, row);
    } catch (error) {
      console.error(
        `[reddit-listener] keyword "${row.keyword}" (project ${row.projectId}) failed:`,
        String(error),
      );
    }
  }

  await watermarks.set(WATERMARK, Date.now());
  if (discovered) console.log(`[reddit-listener] discovered ${discovered} new prospects`);
  return discovered;
}

async function listenForKeyword(
  context: WorkerContext,
  token: string,
  row: {
    projectId: number;
    keyword: string;
    organizationId: string;
    projectName: string;
    propertySummary: string | null;
  },
): Promise<number> {
  const results = await searchReddit(row.keyword, token);
  // The organization's own AI gateway and model when it has connected one
  // (see `resolveAiCredentials`). Resolved once per keyword rather than per
  // result — it decrypts a stored key, and every result here scores against
  // the same organization.
  const credentials = await resolveAiCredentials(context.db, row.organizationId, row.projectId);
  let newCount = 0;

  for (const child of results) {
    const post = child.data;
    const excerpt = (post.selftext || post.title || "").slice(0, 1000);
    if (!excerpt) continue;

    const [inserted] = await context.db
      .insert(schema.prospects)
      .values({
        organizationId: row.organizationId,
        projectId: row.projectId,
        source: "reddit",
        sourceId: post.name,
        sourceUrl: `https://www.reddit.com${post.permalink}`,
        sourceType: "post",
        authorHandle: post.author,
        title: post.title,
        excerpt,
        matchedKeywords: [row.keyword],
        postedAt: new Date(post.created_utc * 1000),
        raw: post,
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
        source: "reddit",
        projectName: row.projectName,
        propertySummary: row.propertySummary,
        keyword: row.keyword,
        title: post.title,
        excerpt,
        credentials,
      });
      if (scored) {
        await context.db
          .update(schema.prospects)
          .set({ relevanceScore: scored.score, relevanceRationale: scored.rationale })
          .where(eq(schema.prospects.id, inserted.id));
      }
    } catch (error) {
      console.error(`[reddit-listener] relevance scoring failed for ${inserted.id}:`, String(error));
    }
  }

  return newCount;
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      throw new Error(`Reddit token request failed (${response.status})`);
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      accessToken: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return cachedToken.accessToken;
  } finally {
    clearTimeout(timer);
  }
}

async function searchReddit(
  keyword: string,
  token: string,
): Promise<Array<{ data: RedditPostData }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(keyword)}&sort=new&limit=${RESULTS_PER_KEYWORD}&t=week`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`Reddit search failed (${response.status}) for "${keyword}"`);
    }
    const body = (await response.json()) as RedditSearchResponse;
    return body.data?.children ?? [];
  } finally {
    clearTimeout(timer);
  }
}

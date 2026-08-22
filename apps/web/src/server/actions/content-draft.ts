"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { GitHubApiError, renderFrontmatter, renderPath } from "@falorb/git-blog-client";
import { requireProject } from "@/server/session";
import { contentInterests } from "@/server/analytics";
import { AiSignalError } from "@/server/ai";
import { generateContentDraft } from "@/server/content-draft";
import { getGithubBlogClient } from "@/server/integrations";
import { resolveRange } from "@/lib/range";
import type { ActionResult } from "./project";
import { deny } from "./guard";

export interface ContentDraftRow {
  id: string;
  topic: string;
  title: string;
  metaDescription: string;
  body: string;
  generatedAt: Date;
  publishStatus: "draft" | "publishing" | "published" | "failed";
  publishedAt: Date | null;
  publishedUrl: string | null;
  publishCommitSha: string | null;
  publishError: string | null;
}

const DRAFT_ROW_COLUMNS = {
  id: schema.contentDrafts.id,
  topic: schema.contentDrafts.topic,
  title: schema.contentDrafts.title,
  metaDescription: schema.contentDrafts.metaDescription,
  body: schema.contentDrafts.body,
  generatedAt: schema.contentDrafts.generatedAt,
  publishStatus: schema.contentDrafts.publishStatus,
  publishedAt: schema.contentDrafts.publishedAt,
  publishedUrl: schema.contentDrafts.publishedUrl,
  publishCommitSha: schema.contentDrafts.publishCommitSha,
  publishError: schema.contentDrafts.publishError,
} as const;

/**
 * Drafts a landing/content page for one "rising interest, thin coverage"
 * topic flagged on the Content page. Re-derives the same interest-graph
 * context that page computes (default 30-day window — this action isn't
 * range-scoped from the UI) rather than trusting anything the client sends,
 * matching the rest of `actions/signals.ts`'s pattern for AI-backed writes.
 */
export async function draftContentPage(slug: string, topic: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "draft a content page");
  if (refusal) return refusal;

  const { range } = resolveRange({});
  const interests = await contentInterests({ projectIds: [project.id], range, limit: 15 });
  const topicContext = interests.find((row) => row.topic === topic) ?? { topic };

  let draft: Awaited<ReturnType<typeof generateContentDraft>>;
  try {
    draft = await generateContentDraft(topic, topicContext, project.name, session.workspace.organizationId, project.id);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof AiSignalError ? error.message : "Could not draft this page.",
    };
  }

  await db().insert(schema.contentDrafts).values({
    organizationId: session.workspace.organizationId,
    projectId: project.id,
    topic,
    title: draft.title,
    metaDescription: draft.metaDescription,
    body: draft.body,
    createdBy: session.user.id,
  });

  revalidatePath(`/p/${slug}/content`);
  return { ok: true, message: "Draft ready — see it under Drafted pages below." };
}

/** Past drafts for a project, newest first — the Content page's "what's already been drafted" list. */
export async function listContentDrafts(slug: string): Promise<ContentDraftRow[]> {
  const { project } = await requireProject(slug);

  return db()
    .select(DRAFT_ROW_COLUMNS)
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.projectId, project.id))
    .orderBy(desc(schema.contentDrafts.generatedAt));
}

/** One draft, scoped to the project so a draft id from another property 404s rather than leaking. */
export async function getContentDraft(slug: string, id: string): Promise<ContentDraftRow | null> {
  const { project } = await requireProject(slug);

  const [row] = await db()
    .select(DRAFT_ROW_COLUMNS)
    .from(schema.contentDrafts)
    .where(and(eq(schema.contentDrafts.projectId, project.id), eq(schema.contentDrafts.id, id)))
    .limit(1);

  return row ?? null;
}

/**
 * Commits a draft to the project's connected GitHub blog repo — the one
 * step in this whole pipeline that is never allowed to run on its own. A
 * human clicking this button is the only way a post reaches a real,
 * publicly visible repo; nothing schedules or auto-triggers this action.
 *
 * Re-publish (calling this again on an already-`published` draft) is
 * supported deliberately: it re-fetches the file's current `sha` and pushes
 * an update-in-place commit to the same path, rather than creating a
 * duplicate — the draft's copy may have been regenerated, or the repo file
 * hand-edited since.
 */
export async function publishContentDraft(slug: string, draftId: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "actOnIntegrations", "publish this draft to your blog repo");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;

  const [draft] = await db()
    .select()
    .from(schema.contentDrafts)
    .where(and(eq(schema.contentDrafts.id, draftId), eq(schema.contentDrafts.projectId, project.id)))
    .limit(1);
  if (!draft) return { ok: false, message: "No such draft." };

  const resolved = await getGithubBlogClient(orgId, project.id);
  if (!resolved) {
    return { ok: false, message: "Connect a GitHub blog repo in Settings → Integrations first." };
  }
  const { client, target } = resolved;

  await db()
    .update(schema.contentDrafts)
    .set({ publishStatus: "publishing" })
    .where(eq(schema.contentDrafts.id, draftId));

  try {
    const path = draft.publishFilePath ?? renderPath(target.pathTemplate, { title: draft.title, date: draft.generatedAt });
    const existing = await client.getFile(target.owner, target.repo, path, target.branch);
    const frontmatter = renderFrontmatter(target.frontmatterTemplate, {
      title: draft.title,
      description: draft.metaDescription,
      date: draft.generatedAt,
    });

    const commit = await client.createOrUpdateFile({
      owner: target.owner,
      repo: target.repo,
      branch: target.branch,
      path,
      content: frontmatter + draft.body,
      message: existing ? `Update: ${draft.title}` : `Publish: ${draft.title}`,
      sha: existing?.sha,
    });

    await db()
      .update(schema.contentDrafts)
      .set({
        publishStatus: "published",
        publishedAt: new Date(),
        publishedUrl: commit.htmlUrl,
        publishCommitSha: commit.commitSha,
        publishFilePath: path,
        publishError: null,
      })
      .where(eq(schema.contentDrafts.id, draftId));

    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.contentDraftPublished,
      targetType: "content_draft",
      targetId: draftId,
      metadata: { path, commitSha: commit.commitSha, repo: `${target.owner}/${target.repo}` },
    });

    revalidatePath(`/p/${slug}/content/drafts/${draftId}`);
    return { ok: true, message: `Published — committed to ${target.owner}/${target.repo}@${target.branch}.` };
  } catch (error) {
    const message = error instanceof GitHubApiError ? error.message : "Could not publish this draft.";
    await db()
      .update(schema.contentDrafts)
      .set({ publishStatus: "failed", publishError: message })
      .where(eq(schema.contentDrafts.id, draftId));
    revalidatePath(`/p/${slug}/content/drafts/${draftId}`);
    return { ok: false, message };
  }
}

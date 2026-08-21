"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireProject } from "@/server/session";
import { contentInterests } from "@/server/analytics";
import { AiSignalError } from "@/server/ai";
import { generateContentDraft } from "@/server/content-draft";
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
}

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
    draft = await generateContentDraft(topic, topicContext, project.name, session.workspace.organizationId);
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
    .select({
      id: schema.contentDrafts.id,
      topic: schema.contentDrafts.topic,
      title: schema.contentDrafts.title,
      metaDescription: schema.contentDrafts.metaDescription,
      body: schema.contentDrafts.body,
      generatedAt: schema.contentDrafts.generatedAt,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.projectId, project.id))
    .orderBy(desc(schema.contentDrafts.generatedAt));
}

/** One draft, scoped to the project so a draft id from another property 404s rather than leaking. */
export async function getContentDraft(slug: string, id: string): Promise<ContentDraftRow | null> {
  const { project } = await requireProject(slug);

  const [row] = await db()
    .select({
      id: schema.contentDrafts.id,
      topic: schema.contentDrafts.topic,
      title: schema.contentDrafts.title,
      metaDescription: schema.contentDrafts.metaDescription,
      body: schema.contentDrafts.body,
      generatedAt: schema.contentDrafts.generatedAt,
    })
    .from(schema.contentDrafts)
    .where(and(eq(schema.contentDrafts.projectId, project.id), eq(schema.contentDrafts.id, id)))
    .limit(1);

  return row ?? null;
}

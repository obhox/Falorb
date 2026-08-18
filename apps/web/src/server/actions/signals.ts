"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { DateRange } from "@falorb/queries";
import { requireProject } from "@/server/session";
import { breakdown, contentInterests, entryPages, exitPages } from "@/server/analytics";
import { AiSignalError, generateSignal } from "@/server/ai";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Generates and caches the Content page's AI recommendation.
 *
 * Re-runs the same queries the page itself renders, rather than trusting
 * whatever the client last saw — a stale or tampered client payload must
 * never end up quoted back as a "recommendation".  Rate-limited per project so
 * a double-click (or a script) cannot spend API budget in a loop.
 */
const MIN_REGENERATE_INTERVAL_MS = 5 * 60_000;

export async function regenerateContentSignal(
  slug: string,
  range: DateRange,
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(
    session.workspace.role,
    "writeAnalysis",
    "regenerate the content recommendation",
  );
  if (refusal) return refusal;

  const [existing] = await db()
    .select({ generatedAt: schema.aiSignals.generatedAt })
    .from(schema.aiSignals)
    .where(and(eq(schema.aiSignals.projectId, project.id), eq(schema.aiSignals.kind, "content")))
    .orderBy(desc(schema.aiSignals.generatedAt))
    .limit(1);

  if (existing && Date.now() - existing.generatedAt.getTime() < MIN_REGENERATE_INTERVAL_MS) {
    return { ok: false, message: "Just regenerated — try again in a few minutes." };
  }

  const scope = { projectIds: [project.id], range };
  const span = range.to - range.from;
  const previousRange: DateRange = { from: range.from - span, to: range.from };

  const [pages, entries, exits, interests, interestsPrevious] = await Promise.all([
    breakdown({ ...scope, field: "path", limit: 15 }),
    entryPages({ ...scope, limit: 10 }),
    exitPages({ ...scope, limit: 10, minPageviews: 10 }),
    contentInterests({ ...scope, limit: 15 }),
    contentInterests({ projectIds: [project.id], range: previousRange, limit: 15 }),
  ]);

  let body: string;
  try {
    body = await generateSignal("content", {
      dateRange: range,
      topPages: pages,
      entryPages: entries,
      exitPages: exits,
      interests,
      interestsPreviousPeriod: interestsPrevious,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AiSignalError ? error.message : "Could not generate a recommendation.",
    };
  }

  await db().insert(schema.aiSignals).values({
    projectId: project.id,
    kind: "content",
    body,
    basedOnRange: range,
  });

  revalidatePath(`/p/${slug}/content`);
  return { ok: true, message: "Recommendation updated" };
}

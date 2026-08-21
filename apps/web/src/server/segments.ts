import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { Filter } from "@falorb/queries";

/**
 * Saved segments — a reusable `Filter[]` tree (see `@falorb/queries`'s
 * `filters.ts`), read back for the `/segments` management page. `cachedCount`/
 * `cachedAt` are refreshed by the worker's `refreshSegmentCounts`
 * (`apps/worker/src/jobs/rollups.ts`), not computed here — this is a plain
 * read of whatever it last wrote.
 */

export interface SegmentView {
  id: string;
  name: string;
  description: string | null;
  projectId: number | null;
  projectName: string | null;
  projectSlug: string | null;
  filters: Filter[];
  cachedCount: number | null;
  cachedAt: string | null;
  createdAt: string;
}

function toFilters(definition: unknown): Filter[] {
  const d = definition as { filters?: unknown } | null;
  return Array.isArray(d?.filters) ? (d.filters as Filter[]) : [];
}

export async function listSegments(organizationId: string): Promise<SegmentView[]> {
  const rows = await db()
    .select({
      id: schema.segments.id,
      name: schema.segments.name,
      description: schema.segments.description,
      projectId: schema.segments.projectId,
      projectName: schema.projects.name,
      projectSlug: schema.projects.slug,
      definition: schema.segments.definition,
      cachedCount: schema.segments.cachedCount,
      cachedAt: schema.segments.cachedAt,
      createdAt: schema.segments.createdAt,
    })
    .from(schema.segments)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.segments.projectId))
    .where(eq(schema.segments.organizationId, organizationId))
    .orderBy(desc(schema.segments.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    projectId: r.projectId,
    projectName: r.projectName,
    projectSlug: r.projectSlug,
    filters: toFilters(r.definition),
    cachedCount: r.cachedCount,
    cachedAt: r.cachedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

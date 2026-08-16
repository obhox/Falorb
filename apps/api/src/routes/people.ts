import { Hono } from "hono";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, createClickHouse, schema, type Database } from "@falorb/db";
import type { Workspace } from "../onboarding";
import { HttpError } from "../http";

/**
 * Manual identity corrections and GDPR requests.
 *
 * Automatic resolution is deliberately conservative — it merges only on a
 * deterministic signal — which means it will sometimes leave two profiles that
 * a human can see are the same person, and very occasionally join two that are
 * not. Both need an operator-facing fix, and neither is safe to hand to an
 * assistant, so these live in the API and are absent from the MCP surface.
 */

type Vars = {
  userId: string | null;
  workspace: Workspace | null;
  scopes: string[];
};

export function peopleRoutes(db: Database): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  const clickhouse = createClickHouse();

  const requireWorkspace = (c: { get: (k: "workspace") => Workspace | null }): Workspace => {
    const workspace = c.get("workspace");
    if (!workspace) throw new HttpError(401, "Sign in first.");
    return workspace;
  };

  /** Confirm a person belongs to the caller's organization before touching it. */
  const owned = async (workspace: Workspace, personId: string) => {
    const [person] = await db
      .select()
      .from(schema.persons)
      .where(
        and(
          eq(schema.persons.id, personId),
          eq(schema.persons.organizationId, workspace.organizationId),
        ),
      )
      .limit(1);
    if (!person) throw new HttpError(404, `No person ${personId} in this workspace.`);
    return person;
  };

  const mergeSchema = z.object({
    survivorId: z.string().uuid(),
    mergedId: z.string().uuid(),
  });

  app.post("/merge", async (c) => {
    const workspace = requireWorkspace(c);
    const parsed = mergeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(422, "survivorId and mergedId must both be UUIDs.");

    const { survivorId, mergedId } = parsed.data;
    if (survivorId === mergedId) throw new HttpError(422, "Cannot merge a person into themselves.");

    const survivor = await owned(workspace, survivorId);
    const merged = await owned(workspace, mergedId);

    const aliases = await db
      .select()
      .from(schema.personAliases)
      .where(eq(schema.personAliases.personId, mergedId));

    await db.transaction(async (tx) => {
      await tx
        .update(schema.personAliases)
        .set({ personId: survivorId })
        .where(eq(schema.personAliases.personId, mergedId));

      await tx
        .update(schema.persons)
        .set({
          firstSeenAt: sql`least(${schema.persons.firstSeenAt}, ${merged.firstSeenAt})`,
          totalSessions: sql`${schema.persons.totalSessions} + ${merged.totalSessions}`,
          totalEvents: sql`${schema.persons.totalEvents} + ${merged.totalEvents}`,
          totalPageviews: sql`${schema.persons.totalPageviews} + ${merged.totalPageviews}`,
          totalRevenue: sql`${schema.persons.totalRevenue} + ${merged.totalRevenue}`,
          email: sql`coalesce(${schema.persons.email}, ${merged.email})`,
          name: sql`coalesce(${schema.persons.name}, ${merged.name})`,
          identifiedId: sql`coalesce(${schema.persons.identifiedId}, ${merged.identifiedId})`,
          companyId: sql`coalesce(${schema.persons.companyId}, ${merged.companyId})`,
          projectIds: sql`(SELECT array_agg(DISTINCT x) FROM unnest(${schema.persons.projectIds} || ${merged.projectIds}) AS x)`,
          updatedAt: new Date(),
        })
        .where(eq(schema.persons.id, survivorId));

      // The snapshot is what makes this reversible; without it an incorrect
      // merge would be permanent.
      await tx.insert(schema.personMerges).values({
        organizationId: workspace.organizationId,
        survivorId,
        mergedId,
        reason: "manual",
        aliasCount: aliases.length,
        mergedSnapshot: merged as unknown as Record<string, unknown>,
      });

      await tx.delete(schema.persons).where(eq(schema.persons.id, mergedId));
    });

    // Re-point the absorbed person's devices so ClickHouse resolves them to
    // the survivor too, otherwise the two stores disagree.
    if (aliases.length) {
      await clickhouse.insert({
        table: "person_overrides",
        values: aliases.map((a) => ({
          project_id: a.projectId,
          distinct_id: a.distinctId,
          person_id: survivorId,
          version: Date.now(),
        })),
        format: "JSONEachRow",
      });
    }

    audit(db, {
      organizationId: workspace.organizationId,
      actorId: c.get("userId"),
      action: AUDIT_ACTIONS.personMerged,
      targetType: "person",
      targetId: survivorId,
      metadata: { mergedId, aliasCount: aliases.length },
    });

    return c.json({
      merged: true,
      survivorId,
      absorbedId: mergedId,
      aliasesMoved: aliases.length,
      note: "History re-attributes within about a minute, once the identity dictionary reloads.",
    });
  });

  /**
   * Reverse a merge from its audit record.
   *
   * Only the profile and its aliases are restored. Lifetime totals are left on
   * the survivor rather than being subtracted back out, because the sessionizer
   * recomputes them from events anyway and guessing at a split would produce
   * two profiles that are both wrong.
   */
  app.post("/unmerge/:mergeId", async (c) => {
    const workspace = requireWorkspace(c);

    const [record] = await db
      .select()
      .from(schema.personMerges)
      .where(
        and(
          eq(schema.personMerges.id, c.req.param("mergeId")),
          eq(schema.personMerges.organizationId, workspace.organizationId),
        ),
      )
      .limit(1);

    if (!record) throw new HttpError(404, "No such merge.");
    if (record.revertedAt) throw new HttpError(409, "That merge has already been reverted.");

    const snapshot = record.mergedSnapshot as Record<string, unknown>;
    if (!snapshot?.id) throw new HttpError(409, "That merge has no snapshot and cannot be reversed.");

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.persons)
        .values({
          id: record.mergedId,
          organizationId: record.organizationId,
          identifiedId: (snapshot.identifiedId as string) ?? null,
          email: (snapshot.email as string) ?? null,
          name: (snapshot.name as string) ?? null,
          projectIds: (snapshot.projectIds as number[]) ?? [],
          firstSeenAt: new Date((snapshot.firstSeenAt as string) ?? Date.now()),
          lastSeenAt: new Date((snapshot.lastSeenAt as string) ?? Date.now()),
        })
        .onConflictDoNothing();

      await tx
        .update(schema.personMerges)
        .set({ revertedAt: new Date() })
        .where(eq(schema.personMerges.id, record.id));
    });

    audit(db, {
      organizationId: workspace.organizationId,
      actorId: c.get("userId"),
      action: AUDIT_ACTIONS.personUnmerged,
      targetType: "person",
      targetId: record.mergedId,
      metadata: { mergeId: record.id, survivorId: record.survivorId },
    });

    return c.json({
      reverted: true,
      restoredId: record.mergedId,
      note: "Device aliases were not moved back automatically — reassign them explicitly if needed.",
    });
  });

  const requestSchema = z.object({
    personId: z.string().uuid(),
    kind: z.enum(["export", "delete"]),
  });

  /**
   * Queue a GDPR request. Deliberately asynchronous: erasure spans both stores
   * and must not be attempted inside a request that can time out halfway.
   */
  app.post("/requests", async (c) => {
    const workspace = requireWorkspace(c);
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(422, "personId (UUID) and kind are required.");

    await owned(workspace, parsed.data.personId);

    const [request] = await db
      .insert(schema.dataRequests)
      .values({
        organizationId: workspace.organizationId,
        personId: parsed.data.personId,
        kind: parsed.data.kind,
        requestedBy: c.get("userId"),
      })
      .returning();

    audit(db, {
      organizationId: workspace.organizationId,
      actorId: c.get("userId"),
      action:
        parsed.data.kind === "delete" ? AUDIT_ACTIONS.personErased : AUDIT_ACTIONS.personExported,
      targetType: "person",
      targetId: parsed.data.personId,
    });

    return c.json(
      {
        id: request!.id,
        kind: request!.kind,
        status: request!.status,
        note:
          parsed.data.kind === "delete"
            ? "Queued. Erasure removes the profile and the entire event history across both stores, and is not reversible."
            : "Queued. The export will contain the full profile and event history.",
      },
      202,
    );
  });

  app.get("/requests", async (c) => {
    const workspace = requireWorkspace(c);
    const rows = await db
      .select()
      .from(schema.dataRequests)
      .where(eq(schema.dataRequests.organizationId, workspace.organizationId))
      .limit(100);
    return c.json({ requests: rows });
  });

  return app;
}

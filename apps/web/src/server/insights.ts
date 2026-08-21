import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { CHARTS, DIMENSIONS, METRICS } from "@/lib/insight-options";

/**
 * Saved cross-project builder queries (`/insights`).
 *
 * The `insights` schema promises a fuller vocabulary (`kind`:
 * trend/funnel/retention/paths/breakdown/stickiness, a full query+visualization
 * definition) than the current builder offers. This deliberately persists
 * only what `/insights` actually has today — metric, dimension, chart, and
 * the property selection — the same pragmatic scope `funnels.ts` uses for
 * saved funnels, rather than building out the rest of the schema's promise
 * speculatively.
 */

export type InsightRow = typeof schema.insights.$inferSelect;

export interface SavedInsight {
  id: string;
  name: string;
  metric: keyof typeof METRICS;
  dimension: keyof typeof DIMENSIONS;
  chart: keyof typeof CHARTS;
  projectSlugs: string[];
}

function toSavedInsight(row: InsightRow): SavedInsight | null {
  const query = row.query as Record<string, unknown>;
  const visualization = row.visualization as Record<string, unknown>;
  const metric = typeof query.metric === "string" ? query.metric : null;
  const dimension = typeof query.dimension === "string" ? query.dimension : null;
  const chart = typeof visualization.chart === "string" ? visualization.chart : null;
  if (!metric || !dimension || !chart) return null;

  return {
    id: row.id,
    name: row.name,
    metric: metric as keyof typeof METRICS,
    dimension: dimension as keyof typeof DIMENSIONS,
    chart: chart as keyof typeof CHARTS,
    projectSlugs: Array.isArray(query.projectSlugs)
      ? query.projectSlugs.filter((s): s is string => typeof s === "string")
      : [],
  };
}

export async function listInsights(organizationId: string): Promise<SavedInsight[]> {
  const rows = await db()
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.organizationId, organizationId))
    .orderBy(asc(schema.insights.createdAt));

  return rows.map(toSavedInsight).filter((row): row is SavedInsight => row !== null);
}

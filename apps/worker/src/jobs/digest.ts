import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { generateSignal, type SignalKind } from "@falorb/ai";
import { digestMail, mailer } from "@falorb/mailer";
import { breakdown, contentInterests, type DateRange } from "@falorb/queries";
import { schema, type WorkerContext } from "../context";
import { resolveAiCredentials } from "@falorb/db";

/**
 * Weekly digest email.
 *
 * Turns the four on-demand AI signals into a push channel, so the owner
 * doesn't have to remember to open the dashboard to see them. Regenerates
 * content, sales, marketing and product for every project in an org, caches
 * each in `ai_signals` exactly as the dashboard's own regeneration would, and
 * mails one summary per org rather than one per project — the reader manages
 * a portfolio, not a single site.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type ProjectRow = typeof schema.projects.$inferSelect;

interface ProjectSections {
  content?: string;
  sales?: string;
  marketing?: string;
  product?: string;
}

export async function sendWeeklyDigests(context: WorkerContext): Promise<number> {
  const orgs = await context.db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.weeklyDigestEnabled, true));

  if (!orgs.length) return 0;

  const orgIds = orgs.map((o) => o.id);
  const projects = await context.db
    .select()
    .from(schema.projects)
    .where(
      and(inArray(schema.projects.organizationId, orgIds), isNull(schema.projects.archivedAt)),
    );

  const projectsByOrg = new Map<string, ProjectRow[]>();
  for (const project of projects) {
    const list = projectsByOrg.get(project.organizationId) ?? [];
    list.push(project);
    projectsByOrg.set(project.organizationId, list);
  }

  const now = Date.now();
  const range: DateRange = { from: now - WEEK_MS, to: now };

  let sent = 0;
  for (const org of orgs) {
    const orgProjects = projectsByOrg.get(org.id);
    if (!orgProjects?.length) continue;

    const sections: Array<ProjectSections & { projectName: string }> = [];
    for (const project of orgProjects) {
      const projectSections = await regenerateProjectSignals(context, org.id, project, range);
      sections.push({ projectName: project.name, ...projectSections });
    }

    // Nothing regenerated for anyone in this org — every kind for every
    // project failed (OpenRouter down, most likely). Nothing worth mailing.
    if (!sections.some((s) => s.content || s.sales || s.marketing || s.product)) continue;

    const recipients = await context.db
      .select({ email: schema.user.email })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.organizationId, org.id),
          or(eq(schema.memberships.role, "owner"), eq(schema.memberships.role, "admin")),
        ),
      );

    for (const { email } of recipients) {
      const ok = await mailer().send(digestMail(email, sections));
      if (ok) sent++;
    }
  }

  if (sent) console.log(`[digest] sent ${sent} weekly digests`);
  return sent;
}

/**
 * Regenerate all four signal kinds for one project.
 *
 * Each kind is its own try/catch, same reasoning as `evaluateAlerts`'s
 * per-rule handling: an AI-gateway failure or a bad ClickHouse query on one
 * kind must not take out the other three, let alone the rest of the org's
 * projects.
 */
async function regenerateProjectSignals(
  context: WorkerContext,
  organizationId: string,
  project: ProjectRow,
  range: DateRange,
): Promise<ProjectSections> {
  const sections: ProjectSections = {};
  // The organization's own AI gateway and model when it has connected one,
  // else the deployment's key. Resolved once for all four kinds — it
  // decrypts a stored credential, and all four bill the same account.
  const credentials = await resolveAiCredentials(context.db, organizationId, project.id);

  try {
    const topics = await contentInterests(context.clickhouse, {
      projectIds: [project.id],
      range,
      limit: 15,
    });
    sections.content = await generateSignal("content", { project: project.name, range, topics }, credentials);
    await persistSignal(context, organizationId, project.id, "content", sections.content, range);
  } catch (error) {
    console.error(`[digest] content signal failed for project ${project.id}:`, String(error));
  }

  try {
    const channels = await breakdown(context.clickhouse, {
      projectIds: [project.id],
      range,
      field: "channel",
      limit: 10,
    });
    sections.marketing = await generateSignal(
      "marketing",
      { project: project.name, range, channels },
      credentials,
    );
    await persistSignal(
      context,
      organizationId,
      project.id,
      "marketing",
      sections.marketing,
      range,
    );
  } catch (error) {
    console.error(`[digest] marketing signal failed for project ${project.id}:`, String(error));
  }

  try {
    const people = await context.db
      .select({
        name: schema.persons.name,
        email: schema.persons.email,
        leadScore: schema.persons.leadScore,
        lastSeenAt: schema.persons.lastSeenAt,
        firstChannel: schema.persons.firstChannel,
      })
      .from(schema.persons)
      .where(
        and(
          eq(schema.persons.organizationId, organizationId),
          isNull(schema.persons.deletedAt),
          sql`${project.id} = ANY(${schema.persons.projectIds})`,
        ),
      )
      .orderBy(desc(schema.persons.leadScore))
      .limit(10);

    sections.sales = await generateSignal("sales", { project: project.name, people }, credentials);
    await persistSignal(context, organizationId, project.id, "sales", sections.sales, range);
  } catch (error) {
    console.error(`[digest] sales signal failed for project ${project.id}:`, String(error));
  }

  try {
    // Same underlying interest-graph rollup as content — deliberately not a
    // funnel/drop-off view yet; see FEATURES.md §14e.
    const topics = await contentInterests(context.clickhouse, {
      projectIds: [project.id],
      range,
      limit: 15,
    });
    sections.product = await generateSignal("product", { project: project.name, range, topics }, credentials);
    await persistSignal(context, organizationId, project.id, "product", sections.product, range);
  } catch (error) {
    console.error(`[digest] product signal failed for project ${project.id}:`, String(error));
  }

  return sections;
}

async function persistSignal(
  context: WorkerContext,
  organizationId: string,
  projectId: number,
  kind: SignalKind,
  body: string,
  range: DateRange,
): Promise<void> {
  await context.db.insert(schema.aiSignals).values({
    organizationId,
    projectId,
    kind,
    body,
    basedOnRange: range,
  });
}

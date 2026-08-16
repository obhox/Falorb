"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createProject, db, normalizeDomain, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import { deny } from "./guard";

/**
 * Mutations on a project.
 *
 * These duplicate what `apps/api` exposes over HTTP, deliberately. The API
 * exists for programs — the MCP server, CI, scripts — and authenticates with a
 * bearer key. The dashboard is a browser with a session cookie, and routing its
 * writes through the API would mean re-authenticating a request the server has
 * already authenticated. Both paths share the same validation helpers and the
 * same schema, so they cannot disagree about what a valid domain is.
 *
 * Every write is scoped by organization in the WHERE clause rather than checked
 * beforehand. A slug from another tenant matches no row and updates nothing,
 * with no window between the check and the write.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function updateProjectSettings(
  slug: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "change property settings");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) {
    return { ok: false, message: "A property needs a name of 1–120 characters." };
  }

  const domains = String(formData.get("domains") ?? "")
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter(Boolean)
    .slice(0, 20);

  const retentionDays = Number(formData.get("retention_days"));
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    return { ok: false, message: "Retention is a whole number of days between 1 and 3650." };
  }

  const timezone = String(formData.get("timezone") ?? "UTC").trim() || "UTC";
  const identityScope = asEnum(formData.get("identity_scope"), ["project", "org"] as const, "org");
  const consentMode = asEnum(
    formData.get("consent_mode"),
    ["off", "opt_in", "opt_out"] as const,
    "off",
  );
  const cookieless = formData.get("cookieless") === "on" ? 1 : 0;

  const [updated] = await db()
    .update(schema.projects)
    .set({
      name,
      domains,
      timezone,
      identityScope,
      consentMode,
      cookieless,
      retentionDays,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.projects.slug, slug),
        eq(schema.projects.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!updated) return { ok: false, message: "No such property." };

  revalidatePath(`/p/${slug}/settings`);
  revalidatePath("/");
  return { ok: true, message: "Saved" };
}

export async function createProjectAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "add a property");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Give the property a name — usually the site's name." };

  const domains = String(formData.get("domains") ?? "")
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter(Boolean)
    .slice(0, 20);

  const project = await createProject(db(), {
    organizationId: session.workspace.organizationId,
    name,
    domains,
    // Portfolio-wide identity is the reason this product exists; a property
    // that cannot be joined to the others cannot answer "which of my products
    // has this person used".
    identityScope: "org",
  });

  revalidatePath("/");
  redirect(`/p/${project.slug}/settings`);
}

export async function archiveProject(slug: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "archiveProject", "archive a property");
  if (refusal) return refusal;

  // Archived, not deleted. The events stay in ClickHouse under their retention
  // window, and the row remains so a re-created project cannot silently
  // inherit another's history through a recycled slug.
  const [archived] = await db()
    .update(schema.projects)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.projects.slug, slug),
        eq(schema.projects.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!archived) return { ok: false, message: "No such property." };

  revalidatePath("/");
  redirect("/");
}

function asEnum<T extends readonly string[]>(
  value: FormDataEntryValue | null,
  allowed: T,
  fallback: T[number],
): T[number] {
  const text = String(value ?? "");
  return (allowed as readonly string[]).includes(text) ? (text as T[number]) : fallback;
}

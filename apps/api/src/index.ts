import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  AUDIT_ACTIONS,
  audit,
  capForRole,
  createDatabase,
  generateApiKey,
  schema,
  scopesForRole,
  verifyApiKey,
  type Database,
} from "@falorb/db";
import { generateDisclosure, resolveMaskingRules } from "@falorb/core";
import { Mailer } from "@falorb/mailer";
import { auth } from "./auth";
import { HttpError } from "./http";
import {
  requireAuth,
  requireCapability,
  requireHumanSession,
  requireScope,
  type Credential,
} from "./guards";
import { teamRoutes } from "./routes/team";
import { peopleRoutes } from "./routes/people";
import { integrationsRoutes } from "./routes/integrations";
import { createProject, ensureWorkspace, normalizeDomain, type Workspace } from "./onboarding";

/**
 * Account and workspace API.
 *
 * Everything a new user needs to go from "no account" to "collecting data":
 * sign up, get a workspace, create a project, copy the snippet, mint an API
 * key for their assistant. The dashboard will consume these same endpoints.
 *
 * Two authentication schemes coexist deliberately. Browser sessions (cookies,
 * via better-auth) are for humans in a dashboard. Bearer API keys are for
 * programs — the MCP server, CI, scripts. Both resolve to the same
 * organization scope, so the authorization logic below does not care which was
 * used.
 */

const db: Database = createDatabase();
const port = Number(process.env.PORT ?? 3003);
const mailer = new Mailer();

type Vars = {
  userId: string | null;
  workspace: Workspace | null;
  scopes: string[];
  credential: Credential | null;
};

const app = new Hono<{ Variables: Vars }>();

app.use(
  "*",
  cors({
    origin: (process.env.FALORB_TRUSTED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((s) => s.trim()),
    // Required for the session cookie to be sent from a browser dashboard.
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

// better-auth owns sign-up, sign-in, sign-out, session and password flows.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * Resolve the caller to an organization, by session cookie or API key.
 * Populates context; does not reject — `requireAuth` does that.
 */
app.use("/api/*", async (c, next) => {
  c.set("userId", null);
  c.set("workspace", null);
  c.set("scopes", []);
  c.set("credential", null);

  const authHeader = c.req.header("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (bearer) {
    const key = await verifyApiKey(db, bearer);
    if (key) {
      const [org] = await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, key.organizationId))
        .limit(1);
      if (org) {
        c.set("credential", "api_key");
        c.set("workspace", {
          organizationId: org.id,
          organizationName: org.name,
          /**
           * The key's own role, not a `"api_key"` placeholder.
           *
           * The placeholder made every key roleless, so `can.*` could not be
           * asked about one and every route fell back to checking scope alone
           * — which is how a `write` key could reach operations the dashboard
           * reserves for owners. Whether the caller is a key at all is a
           * separate fact, recorded above, and `requireHumanSession` reads
           * that rather than inspecting the role.
           */
          role: key.role,
        });
        c.set("scopes", key.scopes.length ? key.scopes : ["read"]);
      }
    }
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user) {
    const workspace = await ensureWorkspace(db, session.user);
    c.set("credential", "session");
    c.set("userId", session.user.id);
    // Lazily creates the organization on first authenticated request.
    c.set("workspace", workspace);
    // Derived from the membership role rather than hardcoded. This line used to
    // read `["read", "write", "admin"]` unconditionally, which meant a viewer
    // signing in held every scope the API knew about.
    c.set("scopes", scopesForRole(workspace.role));
  }
  return next();
});


/** Current user, workspace and projects — the dashboard's bootstrap call. */
app.get("/api/me", async (c) => {
  const workspace = requireAuth(c);
  const projects = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.organizationId, workspace.organizationId),
        isNull(schema.projects.archivedAt),
      ),
    );

  return c.json({
    userId: c.get("userId"),
    organization: {
      id: workspace.organizationId,
      name: workspace.organizationName,
      role: workspace.role,
    },
    scopes: c.get("scopes"),
    projects: projects.map(publicProject),
    onboarded: projects.length > 0,
  });
});

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().max(60).optional(),
  domains: z.array(z.string().max(253)).max(20).optional(),
  timezone: z.string().max(64).optional(),
  identity_scope: z.enum(["project", "org"]).optional(),
});

app.post("/api/projects", async (c) => {
  // Creating a property decides what gets collected and from which domains,
  // which is `manageProject` in the dashboard's own vocabulary — admin, not
  // merely "someone holding a write scope".
  const workspace = requireCapability(c, "manageProject", "create a property");
  requireScope(c, "write");

  const parsed = createProjectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new HttpError(422, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const project = await createProject(db, {
    organizationId: workspace.organizationId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    domains: parsed.data.domains,
    timezone: parsed.data.timezone,
    identityScope: parsed.data.identity_scope,
  });

  audit(db, {
    organizationId: workspace.organizationId,
    actorId: c.get("userId"),
    action: AUDIT_ACTIONS.projectCreated,
    targetType: "project",
    targetId: String(project.id),
    metadata: { slug: project.slug, domains: project.domains },
  });

  const host = process.env.FALORB_INGEST_URL ?? "http://localhost:3001";
  return c.json(
    {
      project: publicProject(project),
      snippet: `<script defer src="${host}/t.js" data-project="${project.publicKey}"></script>`,
    },
    201,
  );
});

app.get("/api/projects", async (c) => {
  const workspace = requireAuth(c);
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, workspace.organizationId))
    .orderBy(desc(schema.projects.createdAt));
  return c.json({ projects: rows.map(publicProject) });
});

const patchProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  domains: z.array(z.string().max(253)).max(20).optional(),
  timezone: z.string().max(64).optional(),
  identity_scope: z.enum(["project", "org"]).optional(),
  consent_mode: z.enum(["off", "opt_in", "opt_out"]).optional(),
  cookieless: z.boolean().optional(),
  retention_days: z.number().int().min(1).max(3650).optional(),
});

app.patch("/api/projects/:slug", async (c) => {
  // Domains, retention, consent mode and cookieless all live behind this one
  // route. The dashboard gates the same settings on `manageProject`; a viewer
  // reaching them through the API was the same escalation by another door.
  const workspace = requireCapability(c, "manageProject", "change property settings");
  requireScope(c, "write");

  const parsed = patchProjectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, "Invalid project settings.");

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.domains) updates.domains = parsed.data.domains.map(normalizeDomain).filter(Boolean);
  if (parsed.data.timezone) updates.timezone = parsed.data.timezone;
  if (parsed.data.identity_scope) updates.identityScope = parsed.data.identity_scope;
  if (parsed.data.consent_mode) updates.consentMode = parsed.data.consent_mode;
  if (parsed.data.cookieless !== undefined) updates.cookieless = parsed.data.cookieless ? 1 : 0;
  if (parsed.data.retention_days) updates.retentionDays = parsed.data.retention_days;

  const [updated] = await db
    .update(schema.projects)
    .set(updates)
    // Scoped to the caller's organization, so a guessed slug from another
    // tenant simply matches nothing.
    .where(
      and(
        eq(schema.projects.slug, c.req.param("slug")),
        eq(schema.projects.organizationId, workspace.organizationId),
      ),
    )
    .returning();

  if (!updated) throw new HttpError(404, "No such project.");

  audit(db, {
    organizationId: workspace.organizationId,
    actorId: c.get("userId"),
    action: AUDIT_ACTIONS.projectUpdated,
    targetType: "project",
    targetId: String(updated.id),
    metadata: parsed.data as Record<string, unknown>,
  });

  return c.json({ project: publicProject(updated) });
});

const createKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(["read", "write"])).min(1).optional(),
  /**
   * The membership role the key acts with. Defaults to `viewer` — a key is a
   * credential handed to a program, and the overwhelmingly common case (an
   * assistant reading reports) needs nothing more. Callers that want a key to
   * change things ask for it explicitly, and never get more than the issuer
   * holds.
   */
  role: z.enum(["viewer", "member", "admin", "owner"]).optional(),
  project: z.string().optional().describe("Restrict the key to one project slug."),
  expires_in_days: z.number().int().min(1).max(3650).optional(),
});

/**
 * Mint an API key. This is what a user gives their assistant to connect over
 * MCP, so the response explains that as well as returning the value.
 */
app.post("/api/keys", async (c) => {
  // Deliberately not `requireAuth` + `write` scope. A write-scoped key could
  // otherwise mint further keys indefinitely, so revoking a leaked credential
  // would not revoke the ones it created — and nothing records the lineage.
  // Issuing a credential is a human act.
  const workspace = requireHumanSession(c, "issue API keys");
  // And an admin act. Being signed in was the only requirement here, so a
  // viewer could mint a write-scoped key and hold, through the key, authority
  // their own account did not have — the first step of the escalation chain
  // that `capForRole` below closes the second half of.
  requireCapability(c, "manageTeam", "issue API keys");

  const parsed = createKeySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(422, "A key needs a name.");

  let projectId: number | null = null;
  if (parsed.data.project) {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.slug, parsed.data.project),
          eq(schema.projects.organizationId, workspace.organizationId),
        ),
      )
      .limit(1);
    if (!project) throw new HttpError(404, `No project "${parsed.data.project}".`);
    projectId = project.id;
  }

  /**
   * Never above the issuer's own role. An admin minting an `owner` key would be
   * an owner with one extra step, and the key would outlive their membership.
   * `capForRole` clamps rather than refuses; comparing the two tells the caller
   * plainly that they got less than they asked for.
   */
  const requestedRole = parsed.data.role ?? "viewer";
  const grantedRole = capForRole(workspace.role, requestedRole);

  const key = generateApiKey();
  const [created] = await db
    .insert(schema.apiKeys)
    .values({
      organizationId: workspace.organizationId,
      projectId,
      name: parsed.data.name,
      keyHash: key.keyHash,
      keyPrefix: key.keyPrefix,
      role: grantedRole,
      scopes: parsed.data.scopes ?? ["read"],
      expiresAt: parsed.data.expires_in_days
        ? new Date(Date.now() + parsed.data.expires_in_days * 86_400_000)
        : null,
    })
    .returning();

  audit(db, {
    organizationId: workspace.organizationId,
    actorId: c.get("userId"),
    action: AUDIT_ACTIONS.apiKeyCreated,
    targetType: "api_key",
    targetId: created!.id,
    // The plaintext never reaches this object; `audit` also redacts key-shaped
    // fields as a second line of defence.
    metadata: { name: created!.name, scopes: created!.scopes, role: grantedRole, projectId },
  });

  const mcpUrl = process.env.FALORB_MCP_URL ?? "http://localhost:3002/mcp";
  return c.json(
    {
      id: created!.id,
      name: created!.name,
      scopes: created!.scopes,
      role: created!.role,
      ...(grantedRole !== requestedRole
        ? {
            roleNote: `Issued as "${grantedRole}" rather than "${requestedRole}": a key cannot hold more authority than the person issuing it.`,
          }
        : {}),
      // Returned exactly once — only the hash is stored.
      key: key.plaintext,
      warning: "Copy this now. It is stored only as a hash and cannot be shown again.",
      mcp: {
        url: mcpUrl,
        note: "Connect an AI assistant by adding this as a remote MCP server with the key as a bearer token.",
      },
    },
    201,
  );
});

app.get("/api/keys", async (c) => {
  const workspace = requireAuth(c);
  const rows = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.organizationId, workspace.organizationId))
    .orderBy(desc(schema.apiKeys.createdAt));

  return c.json({
    keys: rows.map((k) => ({
      id: k.id,
      name: k.name,
      // Never the key itself; the prefix is enough to recognise it.
      prefix: k.keyPrefix,
      scopes: k.scopes,
      role: k.role,
      projectId: k.projectId,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    })),
  });
});

app.delete("/api/keys/:id", async (c) => {
  // Same reasoning as issuance: a key that can revoke keys can revoke the ones
  // an incident responder is relying on.
  const workspace = requireHumanSession(c, "revoke API keys");
  requireCapability(c, "manageTeam", "revoke API keys");

  // Revoked, not deleted — the row is the audit trail of what existed and when
  // it was last used.
  const [revoked] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiKeys.id, c.req.param("id")),
        eq(schema.apiKeys.organizationId, workspace.organizationId),
      ),
    )
    .returning();

  if (!revoked) throw new HttpError(404, "No such key.");

  audit(db, {
    organizationId: workspace.organizationId,
    actorId: c.get("userId"),
    action: AUDIT_ACTIONS.apiKeyRevoked,
    targetType: "api_key",
    targetId: revoked.id,
    metadata: { name: revoked.name },
  });

  return c.json({ revoked: true, id: revoked.id });
});

/**
 * The privacy disclosure for a project, generated from its actual settings.
 *
 * Public on purpose — it contains no secrets, and a site's privacy page may
 * want to fetch it directly rather than paste a copy that then goes stale when
 * the project's settings change.
 *
 * Addressed by **public key, not slug**. Slugs are unique per organization
 * rather than globally (`projects_org_slug_uq`), so looking one up unscoped
 * matched an arbitrary tenant's project: an anonymous caller guessing "blog"
 * or "www" was handed someone else's property name, domain list, retention and
 * masking rules. The public key is 128 bits of randomness and already ships in
 * the page source of the site being described, so requiring it authorises the
 * read against the one audience entitled to it — that site's own visitors —
 * without making anything secret.
 */
app.get("/api/projects/:publicKey/disclosure", async (c) => {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.publicKey, c.req.param("publicKey")))
    .limit(1);

  if (!project) throw new HttpError(404, "No such project.");

  /**
   * Sibling domains are disclosed only when this project actually resolves
   * identity across the organization. Under org-wide scope a visitor is being
   * tracked across those domains and has to be told which; under project scope
   * there is no cross-domain tracking to disclose, and listing the
   * organization's other properties would be a portfolio leak with no
   * transparency purpose to justify it.
   */
  let siblingDomains: string[] = [];
  if (project.identityScope === "org") {
    const siblings = await db
      .select({ domains: schema.projects.domains })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, project.organizationId),
          eq(schema.projects.identityScope, "org"),
        ),
      );
    siblingDomains = [...new Set(siblings.flatMap((s) => s.domains))].filter(
      (d) => !project.domains.includes(d),
    );
  }

  const markdown = generateDisclosure({
    projectName: project.name,
    domains: project.domains,
    consentMode: project.consentMode,
    cookieless: project.cookieless === 1,
    identityScope: project.identityScope,
    retentionDays: project.retentionDays,
    masking: resolveMaskingRules(project.settings),
    siblingDomains,
    companyEnrichment: Boolean(process.env.IPINFO_TOKEN),
  });

  return c.text(markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

// Team management. Mounted after the auth middleware so it inherits the
// resolved workspace and scopes.
app.route("/api/team", teamRoutes(db, mailer));
app.route("/api/people", peopleRoutes(db));
app.route("/api/integrations", integrationsRoutes(db));

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status as 400);
  }
  console.error("[api]", error);
  return c.json({ error: "Internal error." }, 500);
});

function publicProject(p: typeof schema.projects.$inferSelect) {
  return {
    id: p.id,
    uuid: p.uuid,
    name: p.name,
    slug: p.slug,
    domains: p.domains,
    // Safe to expose: it ships in the customer's page source by design.
    publicKey: p.publicKey,
    timezone: p.timezone,
    identityScope: p.identityScope,
    consentMode: p.consentMode,
    cookieless: p.cookieless === 1,
    retentionDays: p.retentionDays,
    createdAt: p.createdAt,
  };
}

// Bun starts a server from this default export; Node does not. Keeping it means
// `bun src/index.ts` still works locally, which is what apps/api/package.json's
// start script uses.
export default { port, fetch: app.fetch };

// The container runs this file with tsx on Node, where the export above binds
// nothing at all -- the process idled with no listener while cheerfully logging
// that it was listening, so the proxy returned 502 for a container that looked
// healthy. Serve explicitly unless Bun is already doing it.
if (!process.versions.bun) {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[api] listening on :${info.port}`);
  });
} else {
  console.log(`[api] listening on :${port}`);
}

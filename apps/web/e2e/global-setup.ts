import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { request, type FullConfig } from "@playwright/test";
import { and, eq, isNull } from "drizzle-orm";
import { createDatabase, schema } from "@falorb/db";

/**
 * Provision the account the suite runs as.
 *
 * Three steps, in this order, and the order matters:
 *
 *  1. Sign up through the app's own better-auth endpoint. Writing a `user` row
 *     directly would produce an account with no credential — better-auth hashes
 *     the password on the signup path, so a hand-written row cannot sign in.
 *  2. Attach that account to the *seeded* organization. `ensureWorkspace`
 *     creates a personal organization on first authenticated request, which is
 *     correct behaviour and useless for testing: the seeded properties, people
 *     and events all live in another organization. Without this step every
 *     assertion below would be checking empty states.
 *  3. Save the cookie so the tests start signed in.
 *
 * The account is generated per run and namespaced `e2e-`, so a run never
 * collides with a human's account or with a previous run.
 */

const AUTH_STATE = resolve(import.meta.dirname, ".auth/state.json");

/** The organization the dev seed creates. */
const SEEDED_ORG_SLUG = "acme";

export interface E2EAccount {
  email: string;
  password: string;
  organizationId: string;
  projectSlugs: string[];
  /**
   * The property with the most events.
   *
   * Tests that assert on figures must run against one that has them. The seed
   * generates traffic for a subset of the properties, so taking the first slug
   * alphabetically lands on an empty one and every assertion fails against a
   * perfectly correct empty state.
   */
  primarySlug: string;
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("No baseURL configured");

  const email = `e2e-${Date.now()}-${randomBytes(3).toString("hex")}@falorb.test`;
  // Generated, never a real credential, and over better-auth's 10-char minimum.
  const password = `e2e-${randomBytes(16).toString("hex")}`;

  const api = await request.newContext({ baseURL });
  const signUp = await api.post("/api/auth/sign-up/email", {
    data: { email, password, name: "End to end" },
  });

  if (!signUp.ok()) {
    throw new Error(
      `Sign-up failed (${signUp.status()}): ${await signUp.text()}\n` +
        "Is Postgres up and migrated? `pnpm infra:up && pnpm db:migrate`.",
    );
  }

  const db = createDatabase();

  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (!user) throw new Error("Sign-up reported success but no user row exists");

  /**
   * Confirm the address, then sign in.
   *
   * Sign-up does not return a session when email verification is required, and
   * it is required whenever a mailer is configured — which it is on any install
   * with `RESEND_API_KEY` set. Relying on `autoSignIn` therefore produced an
   * empty cookie jar and every signed-in test failed at the auth gate, which
   * reads as the dashboard being broken rather than the fixture being wrong.
   *
   * Verifying in the database rather than by clicking a link in an email is the
   * point of a fixture: the flow under test is the dashboard, not the mailer.
   */
  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, user.id));

  const signIn = await api.post("/api/auth/sign-in/email", {
    data: { email, password },
  });

  if (!signIn.ok()) {
    throw new Error(`Sign-in failed (${signIn.status()}): ${await signIn.text()}`);
  }

  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, SEEDED_ORG_SLUG))
    .limit(1);

  if (!org) {
    throw new Error(
      `No "${SEEDED_ORG_SLUG}" organization. Run \`pnpm db:seed\` and \`pnpm db:seed:events\` first — ` +
        "the suite asserts on real figures, not on empty states.",
    );
  }

  // Owner, so the settings and goal-mutation tests can write.
  await db
    .insert(schema.memberships)
    .values({ organizationId: org.id, userId: user.id, role: "owner" });

  const projects = await db
    .select()
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, org.id), isNull(schema.projects.archivedAt)),
    )
    .orderBy(schema.projects.name);

  if (projects.length === 0) {
    throw new Error("The seeded organization has no projects. Run `pnpm db:seed`.");
  }

  // The membership was created after the session cookie was issued, but the
  // organization is resolved per request rather than baked into the cookie, so
  // the existing cookie already sees it.
  const state = await api.storageState();
  if (state.cookies.length === 0) {
    throw new Error(
      "Signed in but captured no cookies — every signed-in test would fail at the auth gate. " +
        "Check that FALORB_APP_URL matches the origin the suite runs on.",
    );
  }

  mkdirSync(dirname(AUTH_STATE), { recursive: true });
  writeFileSync(AUTH_STATE, JSON.stringify(state, null, 2));

  const account: E2EAccount = {
    email,
    password,
    organizationId: org.id,
    projectSlugs: projects.map((project) => project.slug),
    primarySlug: await busiestProject(projects),
  };
  writeFileSync(resolve(dirname(AUTH_STATE), "account.json"), JSON.stringify(account, null, 2));

  await api.dispose();

  console.log(
    `\n  e2e account ${email} owns ${projects.length} seeded properties: ${account.projectSlugs.join(", ")}` +
      `\n  asserting figures against "${account.primarySlug}"\n`,
  );
}

/**
 * Which seeded property carries the most events.
 *
 * Asked of ClickHouse rather than assumed, so the suite keeps working if the
 * generator's distribution changes. Falls back to the first project if the
 * event store is unreachable — the tests will then fail on their own
 * assertions, which is a clearer signal than this throwing during setup.
 */
async function busiestProject(
  projects: { id: number; slug: string }[],
): Promise<string> {
  const fallback = projects[0]!.slug;

  try {
    const { createClickHouse } = await import("@falorb/db");
    const client = createClickHouse();
    const result = await client.query({
      query: `
        SELECT project_id, count() AS events
        FROM events
        WHERE has({ids:Array(UInt32)}, project_id)
        GROUP BY project_id
        ORDER BY events DESC
        LIMIT 1
      `,
      query_params: { ids: projects.map((p) => p.id) },
      format: "JSONEachRow",
    });

    const [row] = await result.json<{ project_id: number }>();
    await client.close();

    return projects.find((p) => p.id === Number(row?.project_id))?.slug ?? fallback;
  } catch {
    return fallback;
  }
}

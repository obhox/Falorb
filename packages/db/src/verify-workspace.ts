import "./load-env";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "./index";
import * as schema from "./schema/index";
import { ensureWorkspace, listWorkspaces, setActiveWorkspace } from "./workspace";

/**
 * Workspace resolution and the switcher's authorization guard, against a real
 * database.
 *
 * This logic decides which tenant's data every query in the dashboard is
 * scoped to, so its failure mode is not "the switcher looks wrong" — it is one
 * customer reading another's analytics. It cannot be unit tested without a
 * database (it is three joins and an update), and the e2e suite provisions a
 * single-workspace account, so neither existing layer covers it. This follows
 * the pattern `apps/worker/src/verify-jobs.ts` already establishes: force the
 * behaviour through against live Postgres in CI's integration job.
 *
 * Everything it creates is namespaced and torn down in a `finally`, so a
 * failure part-way through does not leave rows behind for the next run.
 */

const db = createDatabase();
const STAMP = `wsverify-${process.pid}`;

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name} ${detail}`);
    failed++;
  }
}

async function makeOrg(label: string): Promise<string> {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `${STAMP} ${label}`, slug: `${STAMP}-${label}` })
    .returning();
  return org!.id;
}

const userId = `${STAMP}-user`;

try {
  console.log(`\nverifying workspace resolution\n`);

  const [orgA, orgB, orgForeign] = [
    await makeOrg("a"),
    await makeOrg("b"),
    await makeOrg("foreign"),
  ];

  await db.insert(schema.user).values({
    id: userId,
    name: "Workspace Verify",
    email: `${STAMP}@falorb.test`,
    emailVerified: true,
  });

  // Deliberately inserted newest-first so "oldest membership wins" is a real
  // assertion rather than an accident of insertion order.
  await db.insert(schema.memberships).values({ organizationId: orgA, userId, role: "owner" });
  await db.insert(schema.memberships).values({ organizationId: orgB, userId, role: "viewer" });

  const user = { id: userId, name: "Workspace Verify", email: `${STAMP}@falorb.test` };

  const initial = await ensureWorkspace(db, user);
  check(
    "with no preference set, the oldest membership wins",
    initial.organizationId === orgA,
    `got ${initial.organizationName}`,
  );
  check("and carries that membership's role", initial.role === "owner", `got ${initial.role}`);

  const all = await listWorkspaces(db, userId);
  check("listWorkspaces returns every membership", all.length === 2, `got ${all.length}`);
  check(
    "ordered oldest first, so the switcher does not reshuffle",
    all[0]?.organizationId === orgA && all[1]?.organizationId === orgB,
  );

  check("switching to a workspace you belong to is accepted", await setActiveWorkspace(db, userId, orgB));

  const switched = await ensureWorkspace(db, user);
  check("resolution honours the stored preference", switched.organizationId === orgB);
  check(
    "and the role travels with it, rather than persisting from before",
    switched.role === "viewer",
    `got ${switched.role}`,
  );

  // The guard. The organization id reaches the server action as a form value,
  // so this refusal is the only thing between "change my view" and "read
  // another tenant".
  check(
    "switching to a workspace you do not belong to is refused",
    (await setActiveWorkspace(db, userId, orgForeign)) === false,
  );

  const [afterRefusal] = await db
    .select({ active: schema.user.activeOrganizationId })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  check("a refused switch writes nothing", afterRefusal?.active === orgB);

  // A value that should be impossible, forced in directly: resolution must
  // treat the column as a hint and re-derive access from memberships.
  await db
    .update(schema.user)
    .set({ activeOrganizationId: orgForeign })
    .where(eq(schema.user.id, userId));
  const forced = await ensureWorkspace(db, user);
  check(
    "a forged preference grants nothing and falls back",
    forced.organizationId === orgA,
    `resolved to ${forced.organizationName}`,
  );

  // Losing a membership must take effect on the next request, not the next
  // sign-in.
  await db
    .update(schema.user)
    .set({ activeOrganizationId: orgB })
    .where(eq(schema.user.id, userId));
  await db
    .delete(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.organizationId, orgB)));
  const revoked = await ensureWorkspace(db, user);
  check(
    "removal from the active workspace falls back immediately",
    revoked.organizationId === orgA,
    `resolved to ${revoked.organizationName}`,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
} finally {
  await db.delete(schema.memberships).where(eq(schema.memberships.userId, userId));
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  for (const label of ["a", "b", "foreign"]) {
    await db.delete(schema.organizations).where(eq(schema.organizations.slug, `${STAMP}-${label}`));
  }
}

process.exit(failed === 0 ? 0 : 1);

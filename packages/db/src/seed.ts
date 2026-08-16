import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "./index";
import * as schema from "./schema/index";
import { loadRootEnv } from "./load-env";

loadRootEnv();

/**
 * Development seed. Creates one organization and a project per real property,
 * so the dashboard has something to render before any traffic arrives.
 *
 * Idempotent — safe to re-run; existing projects keep their public key so a
 * snippet already pasted into a site does not stop working.
 */

const PROJECTS: Array<{ name: string; slug: string; domains: string[] }> = [
  { name: "Obhox", slug: "obhox", domains: ["obhox.com", "localhost"] },
  { name: "Linkbry", slug: "linkbry", domains: ["linkbry.com", "api.linkbry.com"] },
  { name: "Letternerd", slug: "letternerd", domains: ["letternerd.com"] },
  { name: "Spendtab", slug: "spendtab", domains: ["spendtab.com", "dashboard.spendtab.com"] },
  { name: "Bund AI", slug: "bund", domains: ["usebund.com", "app.usebund.com"] },
];

function publicKey(): string {
  return "prj_" + randomBytes(16).toString("hex");
}

async function main(): Promise<void> {
  const db = createDatabase();

  let [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, "obhox"))
    .limit(1);

  if (!org) {
    [org] = await db
      .insert(schema.organizations)
      .values({ name: "Obhox", slug: "obhox" })
      .returning();
    console.log(`created organization ${org!.name}`);
  }

  for (const p of PROJECTS) {
    const [existing] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.slug, p.slug))
      .limit(1);

    if (existing) {
      console.log(`  ${p.slug.padEnd(12)} ${existing.publicKey}  (exists, id=${existing.id})`);
      continue;
    }

    const [created] = await db
      .insert(schema.projects)
      .values({
        organizationId: org!.id,
        name: p.name,
        slug: p.slug,
        domains: p.domains,
        publicKey: publicKey(),
        timezone: "UTC",
        // Cross-project person unification is what answers "which of my other
        // products has this person used", so the seeded portfolio opts in.
        identityScope: "org",
      })
      .returning();

    console.log(`  ${p.slug.padEnd(12)} ${created!.publicKey}  (created, id=${created!.id})`);
  }

  await attachOwner(db, org!.id);

  process.exit(0);
}

/**
 * Attach an account to the seeded organization.
 *
 * Without this the seed produces properties nobody can see. `ensureWorkspace`
 * correctly creates a *personal* organization for a new account, so someone who
 * signs up lands on an empty portfolio while every seeded person and event sits
 * in an organization with no members — which reads as "the dashboard is broken"
 * rather than "the seed and the account were never introduced".
 *
 * Takes an existing account rather than creating one: passwords are hashed by
 * better-auth on the signup path, and a user row written directly here would
 * have no credential to sign in with.
 *
 * Usage: `SEED_OWNER_EMAIL=you@example.com pnpm db:seed` after signing up.
 */
async function attachOwner(db: ReturnType<typeof createDatabase>, organizationId: string) {
  const email = process.env.SEED_OWNER_EMAIL?.trim();

  if (!email) {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.memberships)
      .where(eq(schema.memberships.organizationId, organizationId));

    if (count === 0) {
      console.log(
        "\n  No account is attached to this organization, so the dashboard will show\n" +
          "  no properties. Sign up, then re-run with:\n\n" +
          "    SEED_OWNER_EMAIL=you@example.com pnpm db:seed\n",
      );
    }
    return;
  }

  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  if (!user) {
    console.log(`\n  No account with email ${email}. Sign up first, then re-run.\n`);
    return;
  }

  const [existing] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.userId, user.id),
      ),
    )
    .limit(1);

  if (existing) {
    console.log(`\n  ${email} already owns this organization.\n`);
    return;
  }

  await db
    .insert(schema.memberships)
    .values({ organizationId, userId: user.id, role: "owner" });

  console.log(`\n  Attached ${email} to the seeded organization as owner.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * Public waitlist / early-access queue, referral-boosted.
 *
 * `projects.waitlistToken` gates the public `/waitlist/[token]` join page —
 * same on/off-by-presence convention as `dashboards.publicToken`
 * (`apps/web/src/server/sharing.ts`), and the token functions below mirror
 * that file's shape so the two features read as one pattern.
 *
 * Position is never stored (see the doc comment on `waitlistEntries` itself)
 * — it's signup order minus a referral boost, computed fresh on every read so
 * it can't drift the way a cached rank would.
 */

const TOKEN_BYTES = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Spots moved up per successful referral. */
const REFERRAL_BOOST = 3;

/** How many times to retry on a referral-code collision before giving up. */
const CODE_RETRIES = 3;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * Short, URL-safe, and sized so 6 random bytes encode to exactly 8 base64url
 * characters with no padding — same `randomBytes(...).toString("base64url")`
 * approach as `sharing.ts`'s token, just fewer bytes since this is shown to
 * the entrant and typed into a URL, not a bearer secret.
 */
export function generateReferralCode(): string {
  return randomBytes(6).toString("base64url");
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505" &&
    (error as { constraint_name?: string }).constraint_name === constraint
  );
}

/**
 * Public join link for a waitlist, optionally carrying an entrant's own
 * referral code. Prefers `FALORB_WAITLIST_URL` (e.g. `list.<domain>`) over
 * `FALORB_APP_URL` — same reasoning as `referralLinkUrl` in `referrals.ts`:
 * a link people actually invite others with shouldn't read as the internal
 * dashboard's own address. Falls back to `FALORB_APP_URL` when unset.
 */
export function waitlistJoinUrl(token: string, referralCode?: string): string {
  const origin = (
    process.env.FALORB_WAITLIST_URL ??
    process.env.FALORB_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const url = `${origin}/waitlist/${token}`;
  return referralCode ? `${url}?ref=${encodeURIComponent(referralCode)}` : url;
}

/**
 * Turn the waitlist on, or rotate the link if it's already on. Matches
 * `shareProject`'s token generation exactly for consistency.
 */
export async function enableWaitlist(projectId: number): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await db()
    .update(schema.projects)
    .set({ waitlistToken: token, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  return token;
}

/** Turn the waitlist off. Entries survive — this only kills the public link. */
export async function disableWaitlist(projectId: number): Promise<void> {
  await db()
    .update(schema.projects)
    .set({ waitlistToken: null, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
}

export interface ResolvedWaitlist {
  projectId: number;
  projectName: string;
}

/**
 * Resolve a token to the project it gates. Same bounded-regex-then-DB-lookup
 * pattern as `resolveShare`, and the same archived-project cutoff.
 */
export async function resolveWaitlistToken(token: string): Promise<ResolvedWaitlist | null> {
  if (!token || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;

  const [row] = await db()
    .select({
      projectId: schema.projects.id,
      projectName: schema.projects.name,
      archivedAt: schema.projects.archivedAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.waitlistToken, token))
    .limit(1);

  if (!row || row.archivedAt) return null;

  return { projectId: row.projectId, projectName: row.projectName };
}

/** One entrant's position: signup order, minus 3 spots per person they referred. */
export async function waitlistPosition(entryId: string): Promise<number | null> {
  const [entry] = await db()
    .select()
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.id, entryId))
    .limit(1);
  if (!entry) return null;

  const baseRankRows = await db()
    .select({ baseRank: sql<number>`count(*)::int` })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.projectId, entry.projectId),
        lte(schema.waitlistEntries.createdAt, entry.createdAt),
      ),
    );

  const referralCountRows = await db()
    .select({ referralCount: sql<number>`count(*)::int` })
    .from(schema.waitlistEntries)
    .where(eq(schema.waitlistEntries.referredByCode, entry.referralCode));

  // Both are bare aggregates with no GROUP BY, so Postgres always returns
  // exactly one row; the `?? 0` only satisfies the type checker.
  const baseRank = baseRankRows[0]?.baseRank ?? 0;
  const referralCount = referralCountRows[0]?.referralCount ?? 0;

  return Math.max(1, baseRank - REFERRAL_BOOST * referralCount);
}

export interface WaitlistEntryView {
  id: string;
  email: string;
  name: string | null;
  referralCode: string;
  referralCount: number;
  position: number;
  createdAt: Date;
}

/**
 * Every entrant, ranked. One query rather than an N+1 loop: a window function
 * for signup-order rank (`count(*) over (order by created_at)` counts exactly
 * the rows at-or-before this one, ties included), left-joined against a
 * group-by of referral counts per code.
 */
export async function listWaitlistWithPositions(projectId: number): Promise<WaitlistEntryView[]> {
  const referralCounts = db()
    .select({
      referredByCode: schema.waitlistEntries.referredByCode,
      count: sql<number>`count(*)::int`.as("referral_count"),
    })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.projectId, projectId),
        isNotNull(schema.waitlistEntries.referredByCode),
      ),
    )
    .groupBy(schema.waitlistEntries.referredByCode)
    .as("referral_counts");

  const rows = await db()
    .select({
      id: schema.waitlistEntries.id,
      email: schema.waitlistEntries.email,
      name: schema.waitlistEntries.name,
      referralCode: schema.waitlistEntries.referralCode,
      createdAt: schema.waitlistEntries.createdAt,
      baseRank: sql<number>`count(*) over (order by ${schema.waitlistEntries.createdAt})::int`,
      referralCount: sql<number>`coalesce(${referralCounts.count}, 0)::int`,
    })
    .from(schema.waitlistEntries)
    .leftJoin(referralCounts, eq(referralCounts.referredByCode, schema.waitlistEntries.referralCode))
    .where(eq(schema.waitlistEntries.projectId, projectId));

  return rows
    .map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      referralCode: row.referralCode,
      referralCount: row.referralCount,
      position: Math.max(1, row.baseRank - REFERRAL_BOOST * row.referralCount),
      createdAt: row.createdAt,
    }))
    .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
}

export interface JoinWaitlistResult {
  ok: boolean;
  message: string;
  referralCode?: string;
  position?: number;
}

/**
 * Add an entrant, or — on the `(projectId, email)` unique violation — hand
 * back their existing spot instead of an error. Someone re-submitting the
 * form (a double click, a bookmarked page revisited) is not a failure case.
 */
export async function joinWaitlist(
  projectId: number,
  email: string,
  name: string | undefined,
  referredByCode: string | undefined,
): Promise<JoinWaitlistResult> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!isValidEmail(trimmedEmail)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const database = db();
  const trimmedName = name?.trim() || null;
  const trimmedRef = referredByCode?.trim() || null;

  for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
    const referralCode = generateReferralCode();
    try {
      const [inserted] = await database
        .insert(schema.waitlistEntries)
        .values({
          projectId,
          email: trimmedEmail,
          name: trimmedName,
          referralCode,
          referredByCode: trimmedRef,
        })
        .returning();
      if (!inserted) throw new Error("Insert returned no row.");

      const position = await waitlistPosition(inserted.id);
      return {
        ok: true,
        message: "You're on the list.",
        referralCode: inserted.referralCode,
        position: position ?? undefined,
      };
    } catch (error) {
      if (isUniqueViolation(error, "waitlist_entries_referral_code_uq")) continue;

      if (isUniqueViolation(error, "waitlist_entries_project_email_uq")) {
        const [existing] = await database
          .select()
          .from(schema.waitlistEntries)
          .where(
            and(
              eq(schema.waitlistEntries.projectId, projectId),
              eq(schema.waitlistEntries.email, trimmedEmail),
            ),
          )
          .limit(1);

        if (existing) {
          const position = await waitlistPosition(existing.id);
          return {
            ok: true,
            message: "You're already on the list.",
            referralCode: existing.referralCode,
            position: position ?? undefined,
          };
        }
      }

      throw error;
    }
  }

  return { ok: false, message: "Could not join the waitlist right now — try again." };
}

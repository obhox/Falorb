import "server-only";
import { resolveCname } from "node:dns/promises";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { DateRange } from "@falorb/queries";
import { referralClicks } from "./analytics";

const CODE_LOOKUP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

/** A bare, lowercase hostname — no scheme, no path, no trailing dot. */
export const LINK_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * `${FALORB_REFERRAL_URL}/r/<code>` — a dedicated subdomain (e.g.
 * `referral.<domain>`) rather than `FALORB_APP_URL`, so a link someone
 * actually shares doesn't read as the internal dashboard's own address.
 * Same Next.js app, same `/r/[code]` route — `infra/Caddyfile` just proxies
 * this hostname to the same upstream as `dashboard.<domain>`. Falls back to
 * `FALORB_APP_URL` when unset, so this stays backward compatible for any
 * deployment that hasn't added the new hostname yet.
 */
export function referralLinkUrl(code: string): string {
  const origin = (
    process.env.FALORB_REFERRAL_URL ??
    process.env.FALORB_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${origin}/r/${code}`;
}

/** The URL a link resolves to on a project's branded domain, if it has one. */
export function brandedReferralLinkUrl(linkDomain: string, code: string): string {
  return `https://${linkDomain}/${code}`;
}

/** Hostname a branded link domain's CNAME should point at — this app's own referral origin. */
export function linkDomainTarget(): string {
  const origin =
    process.env.FALORB_REFERRAL_URL ?? process.env.FALORB_APP_URL ?? "http://localhost:3000";
  return new URL(origin).hostname;
}

export interface LinkDomainStatus {
  domain: string;
  target: string;
  verified: boolean;
  error?: string;
}

/**
 * Check whether a configured branded domain's DNS actually points here.
 *
 * A plain DNS lookup, not a reachability probe: TLS termination and whether
 * the request actually arrives are the hosting platform's concern (see the
 * "Branded domain" panel's own copy) — this only answers "did the owner add
 * the CNAME", which is the one thing this app can verify on its own.
 */
export async function verifyLinkDomain(domain: string): Promise<LinkDomainStatus> {
  const target = linkDomainTarget();
  try {
    const records = await resolveCname(domain);
    return { domain, target, verified: records.some((r) => r.toLowerCase() === target.toLowerCase()) };
  } catch (error) {
    return {
      domain,
      target,
      verified: false,
      error: error instanceof Error ? error.message : "DNS lookup failed",
    };
  }
}

/**
 * Referral links, read from Postgres, joined against ClickHouse clicks and
 * Postgres conversions.
 *
 * `packages/queries` is ClickHouse-only, so — same shape as `goals.ts` — the
 * Postgres inventory and the cross-store join both live here rather than in
 * the query package.
 */

export type ReferralLinkRow = typeof schema.referralLinks.$inferSelect;

export async function listReferralLinks(projectId: number): Promise<ReferralLinkRow[]> {
  return db()
    .select()
    .from(schema.referralLinks)
    .where(eq(schema.referralLinks.projectId, projectId))
    .orderBy(asc(schema.referralLinks.createdAt));
}

export interface ReferralLeaderboardRow {
  link: ReferralLinkRow;
  clicks: number;
  visitors: number;
  conversions: number;
  /** Percentage of visitors who went on to identify(), or 0 with no visitors. */
  conversionRate: number;
}

export async function referralLeaderboard(
  projectId: number,
  range: DateRange,
  links: ReferralLinkRow[],
): Promise<ReferralLeaderboardRow[]> {
  if (links.length === 0) return [];

  const codes = links.map((link) => link.code);

  const [clickRows, converted] = await Promise.all([
    referralClicks({ projectIds: [projectId], range, limit: 500 }),
    // A person converts once, whenever they eventually identify() — not scoped
    // to the click's date range, since attribution is meant to survive a gap
    // between someone clicking a link and signing up days later.
    db()
      .select({ code: schema.persons.firstReferralCode })
      .from(schema.persons)
      .where(
        and(inArray(schema.persons.firstReferralCode, codes), isNotNull(schema.persons.identifiedId)),
      ),
  ]);

  const clicksByCode = new Map(clickRows.map((row) => [row.ref_code, row]));
  const conversionsByCode = new Map<string, number>();
  for (const row of converted) {
    if (!row.code) continue;
    conversionsByCode.set(row.code, (conversionsByCode.get(row.code) ?? 0) + 1);
  }

  return links.map((link) => {
    const click = clicksByCode.get(link.code);
    const visitors = click?.visitors ?? 0;
    const conversions = conversionsByCode.get(link.code) ?? 0;
    return {
      link,
      clicks: click?.clicks ?? 0,
      visitors,
      conversions,
      conversionRate: visitors > 0 ? (conversions / visitors) * 100 : 0,
    };
  });
}

export interface ReferralRedirectTarget {
  code: string;
  destinationUrl: string | null;
  /** The property's primary domain, used when no explicit destination is set. */
  domain: string | null;
  incentiveKind: string | null;
  incentiveValue: string | null;
  incentiveDescription: string | null;
}

/**
 * Resolve a `/r/<code>` visit to where it should land.
 *
 * Looked up regardless of revocation: a revoked link's destination is still
 * known and still the more useful redirect than a generic fallback for a real
 * visitor who followed it off a business card or an old podcast episode — the
 * code gates no private data, so unlike a dashboard share token there is no
 * security reason to make "revoked" indistinguishable from "never existed".
 * Only a code that matches nothing at all, or whose property has since been
 * archived, falls through to the caller's generic fallback.
 */
export async function resolveReferralLink(code: string): Promise<ReferralRedirectTarget | null> {
  if (!code || code.length > 64 || !CODE_LOOKUP_PATTERN.test(code)) return null;

  const [row] = await db()
    .select({
      code: schema.referralLinks.code,
      destinationUrl: schema.referralLinks.destinationUrl,
      domains: schema.projects.domains,
      archivedAt: schema.projects.archivedAt,
      incentiveKind: schema.referralLinks.incentiveKind,
      incentiveValue: schema.referralLinks.incentiveValue,
      incentiveDescription: schema.referralLinks.incentiveDescription,
    })
    .from(schema.referralLinks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.referralLinks.projectId))
    .where(eq(schema.referralLinks.code, code))
    .limit(1);

  if (!row || row.archivedAt) return null;

  return {
    code: row.code,
    destinationUrl: row.destinationUrl,
    domain: row.domains[0] ?? null,
    incentiveKind: row.incentiveKind,
    incentiveValue: row.incentiveValue,
    incentiveDescription: row.incentiveDescription,
  };
}

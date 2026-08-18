import { requireProject } from "@/server/session";
import {
  brandedReferralLinkUrl,
  linkDomainTarget,
  listReferralLinks,
  referralLeaderboard,
  referralLinkUrl,
  verifyLinkDomain,
} from "@/server/referrals";
import { PageBody } from "@/components/shell/PageHeader";
import { StatStrip } from "@/components/StatStrip";
import { num, pct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";
import { ReferralsPanel, type ReferralLinkView } from "./ReferralsPanel";
import { BrandedDomainCard, type BrandedDomainView } from "./BrandedDomainCard";

export const dynamic = "force-dynamic";

/**
 * Referral links the owner hands out themselves, with attribution from click
 * through to eventual sign-up.
 *
 * Clicks and visitors are scoped to the selected range, same as every other
 * page; conversions are not — someone can click a link today and sign up next
 * week, and attribution is meant to survive that gap.
 */
export default async function ReferralsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { project } = await requireProject((await params).project);
  const search = await searchParams;
  const resolved = resolveRange({
    range: one(search, "range"),
    from: one(search, "from"),
    to: one(search, "to"),
  });

  const [links, domainStatus] = await Promise.all([
    listReferralLinks(project.id),
    project.linkDomain
      ? verifyLinkDomain(project.linkDomain)
      : Promise.resolve({ domain: null, target: linkDomainTarget(), verified: false }),
  ]);
  const leaderboard = await referralLeaderboard(project.id, resolved.range, links);

  const brandedDomain: BrandedDomainView = { ...domainStatus, domain: project.linkDomain };

  const views: ReferralLinkView[] = leaderboard.map((row) => ({
    id: row.link.id,
    label: row.link.label,
    code: row.link.code,
    // Only distributed once the domain's DNS is actually verified — copying
    // an unverified branded URL sends a real visitor to a domain that may
    // not resolve yet.
    url:
      project.linkDomain && brandedDomain.verified
        ? brandedReferralLinkUrl(project.linkDomain, row.link.code)
        : referralLinkUrl(row.link.code),
    active: row.link.revokedAt == null,
    clicks: row.clicks,
    visitors: row.visitors,
    conversions: row.conversions,
    conversionRate: row.conversionRate,
  }));

  const totalClicks = views.reduce((sum, v) => sum + v.clicks, 0);
  const totalVisitors = views.reduce((sum, v) => sum + v.visitors, 0);
  const totalConversions = views.reduce((sum, v) => sum + v.conversions, 0);

  return (
    <PageBody>
      <StatStrip
        stats={[
          { label: "Clicks", value: num(totalClicks), footnote: resolved.label },
          { label: "Visitors", value: num(totalVisitors) },
          { label: "Conversions", value: num(totalConversions), footnote: "all time, per link" },
          {
            label: "Conversion rate",
            value: totalVisitors > 0 ? pct((totalConversions / totalVisitors) * 100) : pct(0),
          },
        ]}
      />

      <ReferralsPanel slug={project.slug} links={views} />

      <BrandedDomainCard slug={project.slug} status={brandedDomain} />
    </PageBody>
  );
}

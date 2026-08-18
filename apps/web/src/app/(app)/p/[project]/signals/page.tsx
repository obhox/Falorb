import { requireProject } from "@/server/session";
import { getLatestSignal, type AiSignalRow } from "@/server/signals";
import { PageBody } from "@/components/shell/PageHeader";
import { one, resolveRange, type SearchParams } from "@/lib/range";
import { MarketingSignalPanel } from "./MarketingSignalPanel";
import { ContentSignalPanel } from "./ContentSignalPanel";
import { ProductSignalPanel } from "./ProductSignalPanel";
import { SalesSignalPanel } from "./SalesSignalPanel";

export const dynamic = "force-dynamic";

function toView(row: AiSignalRow | null) {
  return row ? { body: row.body, generatedAt: row.generatedAt.toISOString() } : null;
}

/**
 * Every AI-generated growth recommendation in one place, rather than
 * scattered across the pages whose data each one happens to reason over.
 *
 * This page only reads whatever was last cached — generation still re-runs
 * each signal's own source queries fresh from wherever they actually live
 * (channel breakdowns, the interest graph, lead data), see
 * `apps/web/src/server/actions/signals.ts`. Nothing on this page is itself a
 * new data source.
 */
export default async function SignalsPage({
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

  const [marketing, content, product, salesProject, salesPortfolio] = await Promise.all([
    getLatestSignal(project.id, "marketing"),
    getLatestSignal(project.id, "content"),
    getLatestSignal(project.id, "product"),
    getLatestSignal(project.id, "sales"),
    getLatestSignal(null, "sales"),
  ]);

  return (
    <PageBody>
      <MarketingSignalPanel slug={project.slug} range={resolved.range} signal={toView(marketing)} />
      <ContentSignalPanel slug={project.slug} range={resolved.range} signal={toView(content)} />
      <ProductSignalPanel slug={project.slug} range={resolved.range} signal={toView(product)} />
      <SalesSignalPanel
        slug={project.slug}
        range={resolved.range}
        signals={{ project: toView(salesProject), portfolio: toView(salesPortfolio) }}
      />
    </PageBody>
  );
}

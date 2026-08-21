import { Card, ChartFrame, FunnelChart } from "@falorb/ui";
import { can } from "@falorb/db";
import { requireProject } from "@/server/session";
import { funnel, FilterError } from "@/server/analytics";
import { PageBody } from "@/components/shell/PageHeader";
import { FunnelBuilder } from "@/components/FunnelBuilder";
import { SavedFunnels } from "./SavedFunnels";
import { Empty } from "@/components/Empty";
import { listFunnels } from "@/server/funnels";
import { num, pct } from "@/lib/format";
import { parseFunnelSpec, serializeSteps } from "@/lib/funnel-spec";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/**
 * Funnel builder and drop-off waterfall.
 *
 * The definition is read from the URL, so the query runs on the server on the
 * first render — no client fetch, and a shared link reproduces exactly what
 * the sender saw.
 */
export default async function FunnelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { session, project } = await requireProject((await params).project);
  const canManage = can.writeAnalysis(session.workspace.role);
  const search = await searchParams;
  const resolved = resolveRange({
    range: one(search, "range"),
    from: one(search, "from"),
    to: one(search, "to"),
  });

  const saved = await listFunnels(project.id);

  /**
   * With nothing in the URL, open the property's first saved funnel rather
   * than the generic placeholder. The placeholder names events (`signup`,
   * `$revenue`) that a given site may simply not send, so the default view of
   * this screen was frequently a funnel nobody had ever entered — which reads
   * as "the product is broken", not as "you have not built a funnel yet".
   */
  const requestedSteps = one(search, "steps");
  const spec = parseFunnelSpec({
    steps: requestedSteps ?? (saved[0] ? serializeSteps(saved[0].steps) : undefined),
    mode: one(search, "mode"),
    window: one(search, "window") ?? (requestedSteps ? undefined : saved[0]?.windowHours.toString()),
  });

  // A hand-edited URL can name a field that is not filterable. The query layer
  // rejects it rather than guessing, and that rejection is a message to the
  // reader, not a 500.
  let result;
  let error: string | null = null;
  try {
    result = await funnel({
      projectIds: [project.id],
      range: resolved.range,
      steps: spec.steps,
      mode: spec.mode,
      windowHours: spec.windowHours,
    });
  } catch (thrown) {
    if (thrown instanceof FilterError) error = thrown.message;
    else throw thrown;
  }

  const steps = result ?? [];
  const entered = steps[0]?.reached ?? 0;
  const converted = steps.at(-1)?.reached ?? 0;

  return (
    <PageBody>
      <SavedFunnels
        slug={project.slug}
        funnels={saved}
        activeSteps={serializeSteps(spec.steps)}
        canManage={canManage}
      />

      <FunnelBuilder slug={project.slug} spec={spec} canSave={canManage} />

      {error ? (
        <Card>
          <Empty
            icon="triangle-alert"
            title="That funnel could not be built"
            body={`${error}. Check the step definitions above.`}
          />
        </Card>
      ) : entered === 0 ? (
        <Card>
          <Empty
            icon="filter-x"
            title="Nobody entered this funnel"
            body={`No one triggered the first step in the last ${resolved.label.toLowerCase()}. Widen the range, or check that the event name matches what the tracker sends.`}
          />
        </Card>
      ) : (
        <>
          <ChartFrame
            title="Conversion"
            subtitle={`${num(entered)} entered · ${num(converted)} completed · ${pct(
              (converted / entered) * 100,
            )} end to end · ${spec.windowHours}h window`}
            height={240}
          >
            <FunnelChart
              height={240}
              steps={steps.map((step) => ({ label: step.label, value: step.reached }))}
            />
          </ChartFrame>

          <Card title="Drop-off" subtitle="Where people leave, step by step">
            <div className="falorb-scroll-x">
            <div style={{ display: "grid", gap: 1 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.6fr) 96px 96px 96px 96px",
                  gap: 12,
                  height: 30,
                  alignItems: "center",
                  borderBottom: "1px solid var(--border-subtle)",
                  fontSize: "var(--size-micro)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--ls-label)",
                  color: "var(--text-muted)",
                  fontWeight: "var(--wt-medium)",
                }}
              >
                <span>Step</span>
                <span style={{ textAlign: "right" }}>Reached</span>
                <span style={{ textAlign: "right" }}>From start</span>
                <span style={{ textAlign: "right" }}>From previous</span>
                <span style={{ textAlign: "right" }}>Dropped</span>
              </div>

              {steps.map((step) => (
                <div
                  key={step.step}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1.6fr) 96px 96px 96px 96px",
                    gap: 12,
                    minHeight: "var(--row-height)",
                    alignItems: "center",
                    borderBottom: "1px solid var(--grid-line)",
                    fontSize: "var(--size-body-sm)",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: "var(--text-body)",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--size-micro)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {step.step + 1}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {step.label}
                    </span>
                  </span>
                  <span style={figure}>{num(step.reached)}</span>
                  <span style={figure}>{pct(step.conversionFromStart)}</span>
                  <span style={figure}>{pct(step.conversionFromPrevious)}</span>
                  <span
                    style={{
                      ...figure,
                      color: step.droppedOff > 0 ? "var(--signal-down)" : "var(--text-muted)",
                    }}
                  >
                    {step.step === 0 ? "—" : num(step.droppedOff)}
                  </span>
                </div>
              ))}
            </div>
            </div>
          </Card>
        </>
      )}
    </PageBody>
  );
}

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-body-sm)",
  color: "var(--text-primary)",
  textAlign: "right",
};

const { ChartFrame, Legend, LineChart, StackedBars, DonutChart, FunnelChart, SankeyDiagram, HeatmapGrid, RetentionMatrix,
        BarSeries, MetricBar, StatTile, DataTable, Select, SegmentedControl, Button, IconButton, Icon, Tag, Badge, Dialog, Input, Checkbox, EmptyState, Tooltip } = window.FalorbDesignSystem_c510a5;

const CHART_TYPES = ["Line", "Bars", "Stacked", "Donut", "Funnel", "Sankey", "Heatmap", "Cohorts", "Table"];
const CHART_ICON = { Line: "trending-up", Bars: "bar-chart-3", Stacked: "layers", Donut: "pie-chart", Funnel: "filter", Sankey: "git-fork", Heatmap: "grid-3x3", Cohorts: "table-2", Table: "list" };

const SAVED_VIEWS = [
  { id: "v1", name: "Portfolio weekly", widgets: 5 },
  { id: "v2", name: "Docs → install", widgets: 3 },
  { id: "v3", name: "DE cohort", widgets: 4 },
  { id: "v4", name: "Weekend traffic", widgets: 2 }
];

function ChartBody({ type, C }) {
  switch (type) {
    case "Line":
      return <LineChart labels={C.months} height={168} series={[{ name: "Visitors", data: C.visitors, fill: true }, { name: "Sessions", data: C.sessions, color: "var(--series-2)" }]} />;
    case "Bars":
      return <BarSeries data={C.months.map((m, i) => ({ label: m, value: C.visitors[i] }))} selected="Jun" height="100%" style={{ flex: 1, minHeight: 168, gridTemplateRows: "1fr auto" }} />;
    case "Stacked":
      return <StackedBars data={C.sourceStack} series={C.sourceSeries} height={168} />;
    case "Donut":
      return <DonutChart segments={C.devices} totalLabel="Sessions" size={140} />;
    case "Funnel":
      return <FunnelChart steps={C.funnel} />;
    case "Sankey":
      return <SankeyDiagram nodes={C.sankeyNodes} links={C.sankeyLinks} height={230} />;
    case "Heatmap":
      return <HeatmapGrid rows={C.days} cols={C.hours} values={C.heat} />;
    case "Cohorts":
      return <RetentionMatrix cohorts={C.cohorts.slice(0, 4)} periodLabel="Week" />;
    case "Table":
      return (
        <DataTable
          dense
          rows={C.months.slice(6).map((m, i) => ({ id: m, month: m, visitors: C.visitors[i + 6].toLocaleString() + "k", sessions: C.sessions[i + 6].toLocaleString() + "k", bounce: (38 - i).toFixed(1) + "%" }))}
          columns={[
            { key: "month", header: "Month", width: "1fr" },
            { key: "visitors", header: "Visitors", width: "90px", align: "right", mono: true },
            { key: "sessions", header: "Sessions", width: "90px", align: "right", mono: true },
            { key: "bounce", header: "Bounce", width: "80px", align: "right", mono: true }
          ]}
        />
      );
    default:
      return null;
  }
}

function Widget({ w, C, onType, onSpan, onRemove }) {
  const legend =
    w.type === "Line" ? <Legend items={[{ label: "Visitors", shape: "line" }, { label: "Sessions", shape: "line", color: "var(--series-2)" }]} />
    : w.type === "Stacked" ? <Legend items={C.sourceSeries.map((s) => ({ label: s.name, color: s.color }))} />
    : null;
  return (
    <ChartFrame
      title={w.title}
      subtitle={w.dimension}
      height={w.type === "Sankey" ? 230 : 168}
      legend={legend}
      style={{ gridColumn: w.span === 2 ? "span 2" : "span 1" }}
      actions={
        <>
          <Select size="sm" value={w.type} options={CHART_TYPES} onChange={(t) => onType(w.id, t)} />
          <IconButton size="sm" label={w.span === 2 ? "Make half width" : "Make full width"} icon={<Icon name={w.span === 2 ? "chevrons-right-left" : "chevrons-left-right"} size={14} />} onClick={() => onSpan(w.id)} />
          <IconButton size="sm" label="Remove widget" icon={<Icon name="x" size={14} />} onClick={() => onRemove(w.id)} />
        </>
      }
    >
      <ChartBody type={w.type} C={C} />
    </ChartFrame>
  );
}

function AddWidgetTile({ onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minHeight: 168, display: "grid", placeItems: "center", gap: 8,
        borderRadius: "var(--radius-card)",
        border: `1px dashed ${hover ? "rgba(125,211,252,.45)" : "var(--border-default)"}`,
        background: hover ? "var(--surface-selected)" : "transparent",
        color: hover ? "var(--glacier-200)" : "var(--text-muted)",
        cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13,
        transition: "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)"
      }}
    >
      <Icon name="plus" size={18} />
      Add widget
    </button>
  );
}

function ViewsScreen() {
  const C = window.FALORB_CHARTS;
  const [view, setView] = React.useState("v1");
  const [dirty, setDirty] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState({ metric: "Visitors", dimension: "Month", type: "Line", title: "" });
  const [widgets, setWidgets] = React.useState([
    { id: 1, title: "Visitors vs sessions", dimension: "Month · all properties", type: "Line", span: 2 },
    { id: 2, title: "Traffic by source", dimension: "Month · stacked", type: "Stacked", span: 1 },
    { id: 3, title: "Sessions by device", dimension: "Share of total", type: "Donut", span: 1 },
    { id: 4, title: "Path across properties", dimension: "Entry → property → action", type: "Sankey", span: 2 },
    { id: 5, title: "Activity by hour", dimension: "Weekday × hour", type: "Heatmap", span: 1 },
    { id: 6, title: "Docs → first event", dimension: "Conversion", type: "Funnel", span: 1 }
  ]);
  const mutate = (fn) => { setDirty(true); fn(); };
  return (
    <>
      <TopBar
        title="Custom views"
        meta={widgets.length + " widgets" + (dirty ? " · unsaved" : "")}
        right={
          <>
            {dirty && <Badge tone="warn" dot>unsaved</Badge>}
            <SegmentedControl size="sm" options={["24h", "7d", "30d", "12m"]} value="12m" onChange={() => {}} />
            <Button size="sm" variant="secondary" iconLeft={<Icon name="share-2" size={13} />}>Share</Button>
            <Button size="sm" variant="primary" onClick={() => setDirty(false)}>Save view</Button>
          </>
        }
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px var(--pad-panel)", borderBottom: "1px solid var(--border-subtle)" }}>
        {SAVED_VIEWS.map((v) => (
          <Tag key={v.id} active={v.id === view} onClick={() => setView(v.id)}>{v.name}</Tag>
        ))}
        <Button size="sm" variant="ghost" iconLeft={<Icon name="plus" size={13} />}>New view</Button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <Select size="sm" variant="bare" value="All properties" options={["All properties", "falorb.io", "docs.falorb.io", "app.falorb.io"]} onChange={() => {}} />
          <Tag icon={<Icon name="filter" size={12} />} onRemove={() => {}}>country = DE</Tag>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "var(--pad-panel)" }}>
        {widgets.length === 0 ? (
          <EmptyState
            icon={<Icon name="layout-dashboard" size={16} />}
            title="This view is empty"
            body="Add a widget to start. Every widget is a metric, a dimension, and a chart type — change any of the three later."
            action={<Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add widget</Button>}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignContent: "start" }}>
            {widgets.map((w) => (
              <Widget
                key={w.id}
                w={w}
                C={C}
                onType={(id, t) => mutate(() => setWidgets((ws) => ws.map((x) => (x.id === id ? { ...x, type: t } : x))))}
                onSpan={(id) => mutate(() => setWidgets((ws) => ws.map((x) => (x.id === id ? { ...x, span: x.span === 2 ? 1 : 2 } : x))))}
                onRemove={(id) => mutate(() => setWidgets((ws) => ws.filter((x) => x.id !== id)))}
              />
            ))}
            <AddWidgetTile onClick={() => setAdding(true)} />
          </div>
        )}
      </div>
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add widget"
        subtitle="Pick a metric and a dimension, then choose how to draw it."
        width={460}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                mutate(() => setWidgets((ws) => [...ws, {
                  id: Date.now(),
                  title: draft.title || `${draft.metric} by ${draft.dimension.toLowerCase()}`,
                  dimension: `${draft.dimension} · custom`,
                  type: draft.type,
                  span: draft.type === "Sankey" ? 2 : 1
                }]));
                setAdding(false);
              }}
            >
              Add to view
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Select label="Metric" value={draft.metric} options={["Visitors", "Sessions", "Events", "Bounce rate", "Median session"]} onChange={(v) => setDraft({ ...draft, metric: v })} />
            <Select label="Dimension" value={draft.dimension} options={["Month", "Day", "Source", "Country", "Device", "Page", "Cohort"]} onChange={(v) => setDraft({ ...draft, dimension: v })} />
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Chart type</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CHART_TYPES.map((t) => (
                <Tag key={t} active={draft.type === t} onClick={() => setDraft({ ...draft, type: t })} icon={<Icon name={CHART_ICON[t]} size={12} />}>{t}</Tag>
              ))}
            </div>
          </div>
          <Input label="Title" placeholder={`${draft.metric} by ${draft.dimension.toLowerCase()}`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Checkbox checked onChange={() => {}} label="Inherit this view's filters" description="country = DE and the current range apply to the new widget." />
        </div>
      </Dialog>
    </>
  );
}

Object.assign(window, { ViewsScreen, Widget, ChartBody, AddWidgetTile });

const { StatTile, BarSeries, MetricBar, Tabs, SegmentedControl, Select, Card, Button, Icon, IconButton, Tag, Badge, GlassPanel,
        ChartFrame, Legend, LineChart, StackedBars, DonutChart, FunnelChart, SankeyDiagram, HeatmapGrid, RetentionMatrix } = window.FalorbDesignSystem_c510a5;

function BreakdownCard({ title, rows, tabs, tab, onTab }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", boxShadow: "var(--edge-top)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 0" }}>
        {tabs ? (
          <Tabs size="sm" tabs={tabs} value={tab} onChange={onTab} style={{ flex: 1, border: "none" }} />
        ) : (
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        )}
      </div>
      <div style={{ display: "grid", gap: 1, padding: "8px 6px 6px" }}>
        {rows.map((r) => <MetricBar key={r.label} {...r} onClick={() => {}} />)}
      </div>
      <div style={{ padding: "0 12px 10px" }}>
        <Button size="sm" variant="ghost" iconRight={<Icon name="arrow-right" size={13} />}>Show all</Button>
      </div>
    </div>
  );
}

function SummaryTab({ property, months, pages, referrers, countries }) {
  const [month, setMonth] = React.useState("Jun");
  const [srcTab, setSrcTab] = React.useState("Referrers");
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 268px", gap: 14 }}>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "16px 16px 12px", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", boxShadow: "var(--edge-top)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Visitors by month</span>
            <Select size="sm" value="Visitors" options={["Visitors", "Sessions", "Events"]} onChange={() => {}} />
          </div>
          <BarSeries data={months} selected={month} onSelect={setMonth} height="100%" style={{ flex: 1, minHeight: 168, gridTemplateRows: "1fr auto" }} />
          <GlassPanel padding={12} radius="var(--radius-card)" style={{ position: "absolute", top: 58, left: "56%", minWidth: 188, pointerEvents: "none" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{month} 2026</div>
            {[["Visitors", "33,801", "var(--series-1)"], ["Sessions", "41,209", "var(--series-2)"]].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, marginTop: 5 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-body)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: c }} />{l}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{v}</span>
              </div>
            ))}
          </GlassPanel>
        </div>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <StatTile label="Unique visitors" value={property.visitors} delta={property.delta} />
          <StatTile label="Sessions" value={property.sessions} delta={4.8} />
          <StatTile label="Bounce rate" value={property.bounce} delta={-3.1} invertDelta />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        <BreakdownCard title="Top pages" rows={pages} />
        <BreakdownCard tabs={["Referrers", "Campaigns"]} tab={srcTab} onTab={setSrcTab} rows={srcTab === "Referrers" ? referrers : referrers.slice(1)} />
        <BreakdownCard title="Countries" rows={countries} />
      </div>
    </>
  );
}

function TrendTab({ C }) {
  return (
    <>
      <ChartFrame
        title="Visitors vs sessions"
        subtitle="Last 12 months · monthly granularity"
        height={220}
        actions={<Select size="sm" value="Monthly" options={["Daily", "Weekly", "Monthly"]} onChange={() => {}} />}
        legend={<Legend items={[{ label: "Visitors", shape: "line" }, { label: "Sessions", shape: "line", color: "var(--series-2)" }]} />}
      >
        <LineChart labels={C.months} height={220} series={[{ name: "Visitors", data: C.visitors, fill: true }, { name: "Sessions", data: C.sessions, color: "var(--series-2)" }]} />
      </ChartFrame>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
        <ChartFrame title="Traffic by source" subtitle="Stacked, monthly" height={180} legend={<Legend items={C.sourceSeries.map((s) => ({ label: s.name, color: s.color }))} />}>
          <StackedBars data={C.sourceStack} series={C.sourceSeries} height={180} />
        </ChartFrame>
        <ChartFrame title="Sessions by device" height={180}>
          <DonutChart segments={C.devices} totalLabel="Sessions" size={150} />
        </ChartFrame>
      </div>
    </>
  );
}

function PathsTab({ C }) {
  return (
    <>
      <ChartFrame
        title="Path across properties"
        subtitle="Entry source → property → action, last 30 days"
        height={280}
        actions={<SegmentedControl size="sm" options={["Sessions", "People"]} value="Sessions" onChange={() => {}} />}
      >
        <SankeyDiagram nodes={C.sankeyNodes} links={C.sankeyLinks} height={280} />
      </ChartFrame>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <ChartFrame title="Docs → first event" subtitle="Conversion funnel" height={170}>
          <FunnelChart steps={C.funnel} />
        </ChartFrame>
        <ChartFrame title="Activity by hour" subtitle="Weekday × hour, sessions" height={170}>
          <HeatmapGrid rows={C.days} cols={C.hours} values={C.heat} />
        </ChartFrame>
      </div>
    </>
  );
}

function RetentionTab({ C }) {
  return (
    <>
      <ChartFrame
        title="Weekly retention"
        subtitle="Share of each cohort seen again in later weeks"
        height={230}
        actions={<SegmentedControl size="sm" options={["Weekly", "Monthly"]} value="Weekly" onChange={() => {}} />}
      >
        <RetentionMatrix cohorts={C.cohorts} periodLabel="Week" />
      </ChartFrame>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <ChartFrame title="Returning vs new" height={170} legend={<Legend items={[{ label: "Returning", shape: "line" }, { label: "New", shape: "line", color: "var(--series-2)" }]} />}>
          <LineChart labels={C.months} height={170} series={[{ name: "Returning", data: C.visitors.map((v) => Math.round(v * 0.42)), fill: true }, { name: "New", data: C.visitors.map((v) => Math.round(v * 0.58)), color: "var(--series-2)" }]} />
        </ChartFrame>
        <ChartFrame title="Sessions by browser" height={170}>
          <DonutChart segments={C.browsers} totalLabel="Sessions" size={140} />
        </ChartFrame>
      </div>
    </>
  );
}

function PropertyScreen({ property, months, pages, referrers, countries, onPeople }) {
  const [tab, setTab] = React.useState("Summary");
  const [range, setRange] = React.useState("12m");
  const C = window.FALORB_CHARTS;
  return (
    <>
      <TopBar
        title={property.domain}
        meta={property.label}
        right={
          <>
            <Tag icon={<Icon name="filter" size={12} />} onRemove={() => {}}>country = DE</Tag>
            <SegmentedControl options={["24h", "7d", "30d", "12m"]} value={range} onChange={setRange} size="sm" />
            <IconButton label="Snippet" icon={<Icon name="code" size={15} />} />
          </>
        }
      />
      <div style={{ padding: "0 var(--pad-panel)", borderBottom: "1px solid var(--border-subtle)" }}>
        <Tabs
          tabs={["Summary", "Trends", "Paths", { value: "People", label: "People", count: "1,284" }, "Retention"]}
          value={tab}
          onChange={(t) => (t === "People" ? onPeople() : setTab(t))}
        />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "var(--pad-panel)", display: "grid", gap: 14, alignContent: "start" }}>
        {tab === "Summary" && <SummaryTab property={property} months={months} pages={pages} referrers={referrers} countries={countries} />}
        {tab === "Trends" && <TrendTab C={C} />}
        {tab === "Paths" && <PathsTab C={C} />}
        {tab === "Retention" && <RetentionTab C={C} />}
      </div>
    </>
  );
}

Object.assign(window, { PropertyScreen, BreakdownCard, SummaryTab, TrendTab, PathsTab, RetentionTab });

const { StatTile, Sparkline, DeltaPill, SegmentedControl, Select, Button, Icon, IconButton, Card } = window.FalorbDesignSystem_c510a5;

function PropertyRow({ p, onOpen }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={() => onOpen(p.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "1.5fr 120px 1fr 96px 88px 24px", alignItems: "center", gap: 14,
        padding: "12px 14px", cursor: "pointer",
        background: hover ? "var(--surface-hover)" : "var(--surface-card)",
        border: "1px solid " + (hover ? "var(--border-default)" : "var(--border-subtle)"),
        borderRadius: "var(--radius-card)",
        transition: "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out)"
      }}
    >
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
          <Icon name="globe" size={13} />{p.domain}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.label}</span>
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: 17, letterSpacing: "-.03em", color: "var(--metric-fg)" }}>{p.visitors}</span>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)" }}>visitors</span>
      </div>
      <Sparkline data={p.series} height={34} color={hover ? "var(--glacier-400)" : "var(--series-2)"} />
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: 13, color: "var(--text-body)" }}>{p.sessions}</span>
      <span style={{ display: "flex", justifyContent: "flex-end" }}><DeltaPill value={p.delta} size="sm" /></span>
      <span style={{ color: hover ? "var(--text-primary)" : "var(--text-muted)", display: "inline-flex", justifyContent: "flex-end" }}><Icon name="chevron-right" size={15} /></span>
    </div>
  );
}

function OverviewScreen({ properties, onOpen, range, onRange }) {
  return (
    <>
      <TopBar
        title="All properties"
        meta="6 tracked · 42 events/s"
        right={
          <>
            <SegmentedControl options={["24h", "7d", "30d", "12m"]} value={range} onChange={onRange} size="sm" />
            <Select size="sm" value="Visitors" options={["Visitors", "Sessions", "Events"]} onChange={() => {}} />
            <IconButton label="Export CSV" icon={<Icon name="download" size={15} />} />
          </>
        }
      />
      <div style={{ flex: 1, overflow: "auto", padding: "var(--pad-panel)", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          <StatTile label="Unique visitors" value="89,736" delta={9.4} size="lg" series={[12, 15, 14, 19, 22, 21, 27, 26, 31, 34]} />
          <StatTile label="Sessions" value="150,172" delta={6.1} size="lg" />
          <StatTile label="Median session" value="1m 48s" delta={2.2} size="lg" />
          <StatTile label="Tracker payload" value="1.94" unit="KB" size="lg" footnote="gzipped · no cookies" />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>Properties</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>sorted by visitors ↓</span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {properties.map((p) => <PropertyRow key={p.id} p={p} onOpen={onOpen} />)}
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { OverviewScreen, PropertyRow });

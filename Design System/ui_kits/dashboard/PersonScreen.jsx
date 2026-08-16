const { StatTile, Badge, Button, IconButton, Icon, Sparkline, Tabs, Dialog, Input, GlassPanel } = window.FalorbDesignSystem_c510a5;

function TimelineRow({ e, first }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "grid", gridTemplateColumns: "84px 20px 1fr 84px", alignItems: "start", gap: 12, padding: "9px 12px", borderRadius: "var(--radius-2)", background: hover ? "var(--surface-hover)" : "transparent", transition: "background var(--dur-1) var(--ease-out)" }}
    >
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", paddingTop: 2 }}>{e.time}</span>
      <span style={{ position: "relative", display: "flex", justifyContent: "center", height: "100%" }}>
        <span style={{ position: "absolute", top: 6, width: 7, height: 7, borderRadius: 999, background: first ? "var(--glacier-400)" : "var(--ink-500)", boxShadow: first ? "0 0 0 3px rgba(125,211,252,.16)" : "none" }} />
        <span style={{ position: "absolute", top: 15, bottom: -14, width: 1, background: "var(--w-8)" }} />
      </span>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)" }}>{e.event}</span>
          <Badge tone="neutral">{e.prop}</Badge>
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.detail}</span>
      </span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", paddingTop: 2 }}>{e.dur}</span>
    </div>
  );
}

function AttrRow({ k, v, mono = true }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--grid-line)" }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{k}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", fontSize: 12, color: "var(--text-primary)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

function PersonScreen({ person, timeline, onBack }) {
  const [tab, setTab] = React.useState("Timeline");
  const [merge, setMerge] = React.useState(false);
  return (
    <>
      <TopBar
        title={person.handle}
        meta={person.ident ? "identified" : "anonymous"}
        right={
          <>
            <Button size="sm" variant="ghost" iconLeft={<Icon name="arrow-left" size={13} />} onClick={onBack}>People</Button>
            <Button size="sm" variant="secondary" iconLeft={<Icon name="git-merge" size={13} />} onClick={() => setMerge(true)}>Merge profile</Button>
            <IconButton label="Delete person data" icon={<Icon name="trash-2" size={15} />} />
          </>
        }
      />
      <div style={{ flex: 1, overflow: "auto", display: "grid", gridTemplateColumns: "1fr 288px", gap: 0 }}>
        <div style={{ display: "grid", gap: 14, padding: "var(--pad-panel)", alignContent: "start" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            <StatTile label="Sessions" value={String(person.sessions)} delta={12.5} />
            <StatTile label="Events" value={String(person.events)} delta={6.2} />
            <StatTile label="Properties seen" value={String(person.props.length)} footnote="across your portfolio" />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Tabs size="sm" tabs={["Timeline", "Sessions", "Attributes"]} value={tab} onChange={setTab} style={{ flex: 1 }} />
          </div>
          <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", padding: 6 }}>
            {timeline.map((e, i) => <TimelineRow key={i} e={e} first={i === 0} />)}
          </div>
        </div>
        <aside style={{ borderLeft: "1px solid var(--border-subtle)", padding: "var(--pad-panel)", display: "grid", gap: 16, alignContent: "start", background: "var(--ink-950)" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>Identity</span>
            <AttrRow k="Person ID" v={person.id === "p1" ? "8f21c4d0e5" : "b7710ac332"} />
            <AttrRow k="First seen" v={person.first} />
            <AttrRow k="Last seen" v={person.last} />
            <AttrRow k="Country" v={person.country} />
            <AttrRow k="Device" v={person.device} mono={false} />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>Activity, 12 months</span>
            <Sparkline data={[1, 2, 1, 4, 3, 6, 5, 9, 7, 12, 10, 14]} height={44} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>Properties</span>
            {person.props.map((p) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-body)" }}>
                <Icon name="globe" size={13} />{p}
              </div>
            ))}
          </div>
        </aside>
      </div>
      <Dialog
        open={merge}
        onClose={() => setMerge(false)}
        title="Merge into another profile"
        subtitle="Events move to the target person. This cannot be undone."
        width={420}
        footer={<><Button variant="ghost" size="sm" onClick={() => setMerge(false)}>Cancel</Button><Button variant="primary" size="sm" onClick={() => setMerge(false)}>Merge</Button></>}
      >
        <Input label="Target person ID or email" mono placeholder="maya@northvolt.dev" />
      </Dialog>
    </>
  );
}

Object.assign(window, { PersonScreen, TimelineRow, AttrRow });

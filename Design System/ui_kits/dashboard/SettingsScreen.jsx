const { Input, Switch, Checkbox, Select, Button, Icon, IconButton, Badge, Card, Tabs, StatTile } = window.FalorbDesignSystem_c510a5;

const SNIPPET = `<script defer src="https://falorb.io/f.js"
  data-property="falorb.io"></script>`;

function Field({ label, hint, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, padding: "14px 0", borderBottom: "1px solid var(--grid-line)", alignItems: "start" }}>
      <div style={{ display: "grid", gap: 3 }}>
        <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SettingsScreen() {
  const [tab, setTab] = React.useState("Tracking");
  const [dnt, setDnt] = React.useState(true);
  const [person, setPerson] = React.useState(true);
  const [sample, setSample] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  return (
    <>
      <TopBar
        title="Settings"
        meta="self-hosted · eu-central · Postgres 16"
        right={<Button size="sm" variant="primary">Save changes</Button>}
      />
      <div style={{ padding: "0 var(--pad-panel)", borderBottom: "1px solid var(--border-subtle)" }}>
        <Tabs tabs={["Tracking", "Privacy", "Storage", "Members", "API"]} value={tab} onChange={setTab} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "var(--pad-panel)", display: "grid", gap: 18, alignContent: "start" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          <StatTile label="Tracker payload" value="1.94" unit="KB" footnote="gzipped, no cookies" />
          <StatTile label="Ingest p95" value="41" unit="ms" delta={-8.2} invertDelta />
          <StatTile label="Retained events" value="8.4M" footnote="41.2 GB of 100 GB" />
        </div>

        <div style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", padding: "4px 16px 16px" }}>
          <Field label="Tracker snippet" hint="Paste before </head>. One property per snippet.">
            <div style={{ display: "grid", gap: 8 }}>
              <pre style={{ margin: 0, padding: "12px 14px", background: "var(--surface-inset)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-3)", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, color: "var(--glacier-200)", overflowX: "auto" }}>{SNIPPET}</pre>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" variant="secondary" iconLeft={<Icon name={copied ? "check" : "clipboard"} size={13} />} onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
                  {copied ? "Copied" : "Copy snippet"}
                </Button>
                <Button size="sm" variant="ghost" iconRight={<Icon name="external-link" size={13} />}>Install docs</Button>
              </div>
            </div>
          </Field>
          <Field label="Property domain" hint="Used to scope events and block spoofed traffic.">
            <Input mono size="sm" value="falorb.io" onChange={() => {}} iconLeft={<Icon name="globe" size={13} />} style={{ maxWidth: 320 }} />
          </Field>
          <Field label="Person-level detail" hint="Stores a first-party identifier so a visitor's history joins across properties.">
            <Switch checked={person} onChange={setPerson} label={person ? "On" : "Off"} />
          </Field>
          <Field label="Do Not Track" hint="Events are dropped at the edge, before the ingest queue.">
            <Checkbox checked={dnt} onChange={setDnt} label="Respect the DNT header" />
          </Field>
          <Field label="Sampling" hint="Applies only above 1M events per day.">
            <div style={{ display: "grid", gap: 10 }}>
              <Checkbox checked={sample} onChange={setSample} label="Sample high-volume properties" description="Keeps p95 query time under 200ms on modest hardware." />
              <Select size="sm" value="1 in 10" options={["1 in 2", "1 in 10", "1 in 100"]} onChange={() => {}} />
            </div>
          </Field>
          <Field label="Retention" hint="Older events are deleted nightly. Aggregates are kept forever.">
            <Input mono size="sm" value="730" suffix="days" onChange={() => {}} style={{ maxWidth: 160 }} />
          </Field>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { SettingsScreen, Field });

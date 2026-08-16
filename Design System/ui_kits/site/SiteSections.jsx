const { Button, Badge, Icon, Card, Tag, DataTable, Sparkline, StatTile } = window.FalorbDesignSystem_c510a5;

const FEATURES = [
  { icon: "layout-grid", title: "One page, every property", body: "Portfolio view first. Visitors, sessions and trend for all six sites before you click anything." },
  { icon: "user-search", title: "Person-level history", body: "Open a single human and read their whole path across your properties, in order, with durations." },
  { icon: "feather", title: "1.94 KB tracker", body: "One request, no cookies, no third-party domain. Passes the same-origin sniff test in every audit." },
  { icon: "server", title: "Runs on your box", body: "Postgres and a single binary. docker compose up, then point a subdomain at it." },
  { icon: "gauge", title: "Fast on modest hardware", body: "p95 query under 200ms at 8.4M retained events on two vCPUs. Sampling only above 1M/day." },
  { icon: "lock", title: "Your data stays yours", body: "No account, no egress, no shared warehouse. Delete a person and the rows are actually gone." }
];

function FeatureGrid() {
  return (
    <section style={{ padding: "104px 32px 0", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 10, maxWidth: 620, marginBottom: 34 }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>Why Falorb</span>
        <h2 style={{ fontSize: 34, letterSpacing: "-.028em", lineHeight: 1.1, fontWeight: 600, color: "var(--ink-0)" }}>Built for the traffic you actually have</h2>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          Warehouse-scale analytics makes you pay in complexity for volume you will never see. Falorb assumes
          thousands of visitors, not millions, and spends the budget on detail instead.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{ display: "grid", gap: 9, padding: 18, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", boxShadow: "var(--edge-top)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "var(--radius-3)", background: "var(--w-4)", border: "1px solid var(--border-subtle)", color: "var(--glacier-300)" }}>
              <Icon name={f.icon} size={15} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{f.title}</span>
            <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>{f.body}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InstallBlock() {
  const [copied, setCopied] = React.useState(false);
  return (
    <section style={{ padding: "104px 32px 0", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>Install</span>
          <h2 style={{ fontSize: 34, letterSpacing: "-.028em", lineHeight: 1.1, fontWeight: 600, color: "var(--ink-0)" }}>Two commands and one script tag</h2>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            No agent, no queue to operate, no separate ingest service. The binary serves the dashboard, the
            tracker and the API on one port.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <Button variant="secondary" iconRight={<Icon name="arrow-right" size={14} />}>Self-hosting guide</Button>
            <Button variant="ghost" iconLeft={<Icon name="github" size={14} />}>Source</Button>
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", background: "var(--surface-inset)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-3)", fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--glacier-200)" }}>
            <span style={{ color: "var(--text-muted)" }}>$</span>docker compose up -d falorb
          </div>
          <div style={{ padding: "12px 14px", background: "var(--surface-inset)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-3)", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6, color: "var(--glacier-200)", whiteSpace: "pre" }}>
{`<script defer src="https://analytics.you.dev/f.js"
  data-property="you.dev"></script>`}
          </div>
          <div>
            <Button size="sm" variant="ghost" iconLeft={<Icon name={copied ? "check" : "clipboard"} size={13} />} onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
              {copied ? "Copied" : "Copy snippet"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

const PLANS = [
  { name: "Self-hosted", price: "Free", meta: "MIT licensed", body: "Unlimited properties and events on your own hardware.", cta: "Get the binary", variant: "secondary", rows: ["Every feature", "Community support", "No telemetry"] },
  { name: "Supported", price: "$39", meta: "per month, per instance", body: "The same binary, plus upgrade help and a private issue queue.", cta: "Start supported", variant: "primary", featured: true, rows: ["Priority patches", "Migration review", "48h response"] },
  { name: "Managed", price: "$140", meta: "per month", body: "We run the instance in your region and hand you the keys.", cta: "Talk to us", variant: "secondary", rows: ["Your region", "Daily snapshots", "99.9% target"] }
];

function Pricing() {
  return (
    <section style={{ padding: "104px 32px 0", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 10, maxWidth: 560, marginBottom: 32 }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>Pricing</span>
        <h2 style={{ fontSize: 34, letterSpacing: "-.028em", lineHeight: 1.1, fontWeight: 600, color: "var(--ink-0)" }}>Pay for help, not for events</h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {PLANS.map((p) => (
          <div key={p.name} style={{ display: "grid", gap: 14, padding: 20, background: p.featured ? "var(--surface-raised)" : "var(--surface-card)", border: "1px solid " + (p.featured ? "rgba(125,211,252,.24)" : "var(--border-subtle)"), borderRadius: "var(--radius-card)", boxShadow: p.featured ? "var(--shadow-3)" : "var(--edge-top)", alignContent: "start" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{p.name}</span>
              {p.featured && <Badge tone="accent">most picked</Badge>}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: 34, letterSpacing: "-.03em", color: "var(--ink-0)" }}>{p.price}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.meta}</span>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>{p.body}</p>
            <div style={{ display: "grid", gap: 7, paddingTop: 4, borderTop: "1px solid var(--grid-line)" }}>
              {p.rows.map((r) => (
                <span key={r} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-body)" }}>
                  <Icon name="check" size={13} color="var(--glacier-400)" />{r}
                </span>
              ))}
            </div>
            <Button variant={p.variant} fullWidth>{p.cta}</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SiteFooter() {
  const cols = [
    { h: "Product", items: ["Overview", "Person profiles", "Self-hosting", "Changelog"] },
    { h: "Docs", items: ["Install", "Tracker API", "Query API", "Migrating in"] },
    { h: "Project", items: ["GitHub", "Roadmap", "License", "Security"] }
  ];
  return (
    <footer style={{ marginTop: 104, padding: "34px 32px 40px", borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(3,1fr)", gap: 28, maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: "var(--ink-50)", color: "var(--ink-1000)", fontWeight: 600, fontSize: 13, letterSpacing: "-.04em" }}>F</span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.03em", color: "var(--text-primary)" }}>Falorb</span>
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 260, lineHeight: 1.55 }}>Self-hosted, first-party analytics. Built in Berlin, licensed MIT.</span>
        </div>
        {cols.map((c) => (
          <div key={c.h} style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: 500 }}>{c.h}</span>
            {c.items.map((i) => <a key={i} href="#" style={{ fontSize: 13 , color: "var(--text-secondary)" }}>{i}</a>)}
          </div>
        ))}
      </div>
    </footer>
  );
}

Object.assign(window, { FeatureGrid, InstallBlock, Pricing, SiteFooter });

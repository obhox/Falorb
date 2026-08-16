const { Button, Badge, Tag, Icon, StatTile, Sparkline, MetricBar, GlassPanel, SegmentedControl, DataTable, Card } = window.FalorbDesignSystem_c510a5;

function SiteNav() {
  const links = ["Product", "Docs", "Pricing", "Changelog", "GitHub"];
  return (
    <nav style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 26, height: 58, padding: "0 32px", background: "rgba(9,9,9,.72)", backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)", borderBottom: "1px solid var(--border-subtle)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: "var(--ink-50)", color: "var(--ink-1000)", fontWeight: 600, fontSize: 13, letterSpacing: "-.04em" }}>F</span>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.03em", color: "var(--text-primary)" }}>Falorb</span>
      </span>
      <span style={{ display: "flex", gap: 20, marginLeft: 12 }}>
        {links.map((l) => (
          <a key={l} href="#" style={{ fontSize: 13, color: "var(--text-secondary)" }}>{l}</a>
        ))}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <Button size="sm" variant="ghost">Sign in</Button>
        <Button size="sm" variant="primary">Self-host free</Button>
      </span>
    </nav>
  );
}

function Hero() {
  return (
    <section style={{ position: "relative", padding: "84px 32px 0", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "grid", justifyItems: "center", gap: 18, textAlign: "center" }}>
        <Badge tone="neutral" dot>v2.4 · Postgres 16 support</Badge>
        <h1 style={{ maxWidth: 860, fontSize: 62, lineHeight: 1.02, letterSpacing: "-.035em", fontWeight: 600, color: "var(--ink-0)" }}>
          Every property on one page. Every person in one history.
        </h1>
        <p style={{ maxWidth: 560, fontSize: 16, lineHeight: 1.55, color: "var(--text-secondary)" }}>
          Falorb is first-party analytics you host yourself. A 1.94 KB tracker, no cookies, and person-level
          detail across your whole portfolio — built for small-to-medium traffic, not for ad networks.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <Button size="lg" variant="primary" iconLeft={<Icon name="terminal" size={15} />}>Start self-hosting</Button>
          <Button size="lg" variant="glass" iconRight={<Icon name="arrow-right" size={15} />}>Read the docs</Button>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
          <span>MIT licensed</span><span>·</span><span>docker compose up</span><span>·</span><span>no vendor account</span>
        </div>
      </div>
      <ProductShot />
    </section>
  );
}

function ProductShot() {
  const months = [22, 31, 27, 38, 44, 36, 49, 41, 54, 47, 58, 62];
  return (
    <div style={{ position: "relative", marginTop: 54 }}>
      <div style={{ position: "absolute", inset: "-40px -10px 40px", background: "radial-gradient(60% 60% at 50% 0%, rgba(125,211,252,.10), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "relative", padding: 12, background: "var(--surface-panel)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-shell)", boxShadow: "var(--shadow-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 6px 12px" }}>
          <span style={{ display: "flex", gap: 5 }}>
            {["var(--ink-600)", "var(--ink-600)", "var(--ink-600)"].map((c, i) => <span key={i} style={{ width: 8, height: 8, borderRadius: 999, background: c }} />)}
          </span>
          <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>analytics.yourcompany.dev</span>
          <span style={{ marginLeft: "auto" }}><SegmentedControl size="sm" options={["24h", "7d", "30d", "12m"]} value="12m" onChange={() => {}} /></span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
          <StatTile label="Unique visitors" value="89,736" delta={9.4} series={[12, 15, 14, 19, 22, 21, 27, 26, 31, 34]} />
          <StatTile label="Sessions" value="150,172" delta={6.1} />
          <StatTile label="Median session" value="1m 48s" delta={2.2} />
          <StatTile label="Tracker payload" value="1.94" unit="KB" footnote="gzipped · no cookies" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
          <div style={{ position: "relative", padding: 16, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
              {months.map((v, i) => (
                <div key={i} style={{ flex: 1, height: `${(v / 62) * 100}%`, borderRadius: "var(--radius-2)", background: i === 8 ? "var(--glacier-400)" : "var(--w-4)", backgroundImage: i === 8 ? undefined : "var(--hatch)", borderTop: i === 8 ? "none" : "1.5px solid var(--series-1)" }} />
              ))}
            </div>
            <GlassPanel padding={12} radius="var(--radius-card)" style={{ position: "absolute", top: 30, left: "48%", minWidth: 184 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 7 }}>May 2026</div>
              {[["Visitors", "33,801", "var(--series-1)"], ["Sessions", "41,209", "var(--series-2)"]].map(([l, v, c]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 18, marginTop: 4 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-body)" }}><span style={{ width: 6, height: 6, borderRadius: 999, background: c }} />{l}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)" }}>{v}</span>
                </div>
              ))}
            </GlassPanel>
          </div>
          <div style={{ display: "grid", gap: 1, padding: 6, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", alignContent: "start" }}>
            {window.FALORB_SITE.pages.map((p) => <MetricBar key={p.label} {...p} icon={<Icon name="file" size={13} />} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SiteNav, Hero, ProductShot });

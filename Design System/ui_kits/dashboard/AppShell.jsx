const { Icon, IconButton, Button, SidebarNav, Select, Input } = window.FalorbDesignSystem_c510a5;

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 10px 14px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: "var(--ink-50)", color: "var(--ink-1000)", fontWeight: 600, fontSize: 13, letterSpacing: "-.04em" }}>F</span>
      <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.03em", color: "var(--text-primary)" }}>Falorb</span>
      <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>v2.4</span>
    </div>
  );
}

function AccountFooter() {
  return (
    <div style={{ display: "grid", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}>
        <span style={{ width: 22, height: 22, borderRadius: 999, background: "var(--ink-700)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--text-body)", fontWeight: 600 }}>EP</span>
        <span style={{ display: "grid" }}>
          <span style={{ fontSize: 12, color: "var(--text-body)" }}>Emma Parson</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>self-hosted · eu-central</span>
        </span>
      </div>
      <div style={{ display: "grid", gap: 5, padding: "0 10px 2px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}>
          <span>Event storage</span><span style={{ fontFamily: "var(--font-mono)" }}>41.2 / 100 GB</span>
        </div>
        <div style={{ height: 3, borderRadius: 999, background: "var(--w-6)", overflow: "hidden" }}>
          <div style={{ width: "41%", height: "100%", background: "var(--glacier-400)" }} />
        </div>
      </div>
    </div>
  );
}

function TopBar({ title, meta, right }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 14, height: 52, padding: "0 var(--pad-panel)", borderBottom: "1px solid var(--border-subtle)", flex: "0 0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.022em", color: "var(--text-primary)", whiteSpace: "nowrap" }}>{title}</h1>
        {meta && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{meta}</span>}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>{right}</div>
    </header>
  );
}

function AppShell({ view, onView, properties, children }) {
  return (
    <div style={{ height: "100%", display: "flex", gap: "var(--gutter-panel)", padding: "var(--shell-pad)", background: "var(--bg-app)", boxSizing: "border-box" }}>
      <aside style={{ flex: "0 0 224px", display: "flex", flexDirection: "column", padding: 10, background: "var(--surface-panel)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-shell)", boxShadow: "var(--shadow-2)" }}>
        <Wordmark />
        <SidebarNav
          value={view}
          onChange={onView}
          style={{ flex: 1 }}
          sections={[
            { items: [
              { value: "overview", label: "All properties", icon: <Icon name="layout-grid" size={15} /> },
              { value: "people", label: "People", icon: <Icon name="users" size={15} />, meta: "1,284" },
              { value: "views", label: "Custom views", icon: <Icon name="layout-dashboard" size={15} />, meta: "4" },
              { value: "events", label: "Live events", icon: <Icon name="activity" size={15} />, meta: "42/s" }
            ] },
            { label: "Properties", items: properties.slice(0, 5).map((p) => ({
              value: "prop:" + p.id, label: p.domain, icon: <Icon name="globe" size={15} />, meta: p.visitors.split(",")[0] + "k"
            })) },
            { label: "Instance", items: [
              { value: "settings", label: "Settings", icon: <Icon name="settings" size={15} /> },
              { value: "health", label: "Health", icon: <Icon name="heart-pulse" size={15} /> }
            ] }
          ]}
        />
        <AccountFooter />
      </aside>
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--surface-panel)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-shell)", boxShadow: "var(--shadow-3)", overflow: "hidden", position: "relative" }}>
        {children}
      </main>
    </div>
  );
}

Object.assign(window, { AppShell, TopBar, Wordmark, AccountFooter });

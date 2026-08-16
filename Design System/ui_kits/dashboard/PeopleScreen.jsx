const { DataTable, Input, Select, Checkbox, Button, IconButton, Icon, Badge, Tag, EmptyState, DeltaPill } = window.FalorbDesignSystem_c510a5;

function FilterBar({ query, onQuery, ident, onIdent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px var(--pad-panel)", borderBottom: "1px solid var(--border-subtle)" }}>
      <Input size="sm" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search people, emails, IDs…" iconLeft={<Icon name="search" size={13} />} suffix="⌘K" style={{ width: 280 }} />
      <Select size="sm" value="All properties" options={["All properties", "falorb.io", "docs.falorb.io", "app.falorb.io"]} onChange={() => {}} />
      <Select size="sm" value="Last 30 days" options={["Last 24 hours", "Last 7 days", "Last 30 days", "Last 12 months"]} onChange={() => {}} />
      <Checkbox checked={ident} onChange={onIdent} label="Identified only" />
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <Button size="sm" variant="secondary" iconLeft={<Icon name="download" size={13} />}>Export</Button>
      </div>
    </div>
  );
}

function PeopleScreen({ people, onOpen }) {
  const [query, setQuery] = React.useState("");
  const [ident, setIdent] = React.useState(false);
  const rows = people.filter((p) => (!ident || p.ident) && p.handle.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <TopBar
        title="People"
        meta={rows.length + " of 1,284 · person-level detail on"}
        right={<><Tag active onClick={() => {}}>returning</Tag><IconButton label="Columns" icon={<Icon name="columns-3" size={15} />} /></>}
      />
      <FilterBar query={query} onQuery={setQuery} ident={ident} onIdent={setIdent} />
      <div style={{ flex: 1, overflow: "auto" }}>
        <DataTable
          rows={rows}
          onRowClick={(r) => onOpen(r.id)}
          emptyState={<EmptyState icon={<Icon name="search-x" size={16} />} title="No people match this search" body="Clear the search, or widen the range to 12 months." action={<Button size="sm" variant="secondary" onClick={() => { setQuery(""); setIdent(false); }}>Reset filters</Button>} />}
          columns={[
            { key: "handle", header: "Person", width: "1.6fr", render: (r) => (
              <>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 999, background: r.ident ? "rgba(125,211,252,.14)" : "var(--w-6)", color: r.ident ? "var(--glacier-300)" : "var(--text-muted)", flex: "0 0 auto" }}>
                  <Icon name={r.ident ? "user-check" : "user"} size={12} />
                </span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}>{r.handle}</span>
              </>
            ) },
            { key: "props", header: "Properties", width: "1.1fr", render: (r) => (
              <span style={{ display: "flex", gap: 4, overflow: "hidden" }}>
                {r.props.map((x) => <Badge key={x} tone="neutral">{x}</Badge>)}
              </span>
            ) },
            { key: "sessions", header: "Sessions", width: "86px", align: "right", mono: true },
            { key: "events", header: "Events", width: "80px", align: "right", mono: true },
            { key: "country", header: "Geo", width: "60px", align: "center", mono: true },
            { key: "device", header: "Device", width: "1fr" },
            { key: "last", header: "Last seen", width: "100px", align: "right" }
          ]}
        />
      </div>
    </>
  );
}

Object.assign(window, { PeopleScreen, FilterBar });

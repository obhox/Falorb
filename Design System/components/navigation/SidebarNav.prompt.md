One-line: the dashboard's left rail — sectioned rows with optional trailing figures.

```jsx
<SidebarNav value={view} onChange={setView} sections={[
  { items: [{ value: "overview", label: "All properties", icon: <Icon name="layout-grid" size={15} /> }] },
  { label: "Properties", items: [{ value: "io", label: "falorb.io", meta: "12.4k" }] }
]} />
```

Selected row: glacier tint + hairline glacier border. Section labels are 11px uppercase, tracked.

One-line: the dense row grid behind every list view — sessions, people, events, properties.

```jsx
<DataTable rows={people} selectedId={id} onRowClick={open} columns={[
  { key: "person", header: "Person", width: "1.4fr" },
  { key: "sessions", header: "Sessions", width: "90px", align: "right", mono: true }
]} />
```

Sticky 30px header, uppercase micro headers, hairline row rules. Numeric columns are right-aligned and mono.

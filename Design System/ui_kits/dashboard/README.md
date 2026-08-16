# Dashboard UI kit

An interactive recreation of the Falorb dashboard at 1440×900. Open `index.html`.

## Flow

1. **All properties** (`OverviewScreen`) — global stat strip, then one row per property with a sparkline and
   delta. Click any row to drill in.
2. **Property detail** (`PropertyScreen`) — four tabs. **Summary**: hatched 12-month bar chart with a glass
   hover card, three stat tiles, three breakdown cards. **Trends**: `LineChart` (visitors vs sessions),
   `StackedBars` by source, `DonutChart` by device. **Paths**: `SankeyDiagram` (entry → property → action),
   `FunnelChart`, `HeatmapGrid`. **Retention**: `RetentionMatrix` cohort triangle plus returning-vs-new and
   browser share. The People tab jumps to the list.
3. **People** (`PeopleScreen`) — filter bar plus a dense table. Type in the search to filter; tick
   "Identified only"; empty the result set to see the `EmptyState`. Click a row for the profile.
4. **Person profile** (`PersonScreen`) — sessions/events/properties tiles, a cross-property event timeline,
   and an identity sidebar. "Merge profile" opens the `Dialog`.
5. **Custom views** (`ViewsScreen`) — saved views as tags, a two-column widget grid, and per-widget controls:
   switch chart type from a Select (Line / Bars / Stacked / Donut / Funnel / Sankey / Heatmap / Cohorts /
   Table), toggle half vs full width, remove. "Add widget" opens a Dialog for metric + dimension + chart
   type; removing every widget shows the `EmptyState`. Edits mark the view unsaved until Save.
6. **Settings** (`SettingsScreen`) — tracker snippet with a working copy button, plus tracking/privacy
   fields. Reached from the sidebar's Instance section.

## Composition

Every screen is built from the published primitives (`StatTile`, `DataTable`, `BarSeries`, `MetricBar`,
`Tabs`, `SegmentedControl`, `SidebarNav`, `Dialog`, `GlassPanel`, …) — nothing is re-implemented locally.
The kit's own files are only shell and screen layout:

| File | Role |
| --- | --- |
| `AppShell.jsx` | Floating sidebar + main panel, wordmark, account footer, `TopBar` |
| `OverviewScreen.jsx` | Portfolio view and its property row |
| `PropertyScreen.jsx` | Single-property analysis, `BreakdownCard` |
| `PeopleScreen.jsx` | Filter bar and people table |
| `PersonScreen.jsx` | Person profile, timeline row, attribute row |
| `ViewsScreen.jsx` | Custom-view builder: widget grid, chart-type switching, add-widget dialog |
| `SettingsScreen.jsx` | Settings fields and snippet block |
| `data.js` | Fixture data on `window.FALORB` |
| `charts-data.js` | Chart fixtures on `window.FALORB_CHARTS` (series, sankey graph, heat matrix, cohorts) |

Data is fictional. Row counts are abbreviated: 6 properties and 8 people stand in for 6 and 1,284.

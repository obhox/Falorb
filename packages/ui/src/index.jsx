/**
 * The Falorb design system, as consumed by the app.
 *
 * These are the published primitives from `Design System/components`, copied
 * in verbatim apart from three deliberate changes:
 *
 *  1. Every component carries `"use client"`. They are all styled with inline
 *     objects and most track hover/press state, so they are leaves in the tree:
 *     server components fetch and format, these render.
 *  2. `Icon` resolves from the bundled `lucide-react` set instead of hydrating
 *     a CDN sprite, so glyphs are present in the first server-rendered paint.
 *  3. `.d.ts` return types are `React.JSX.Element`; the global JSX namespace
 *     was removed in the React 19 types.
 *  4. `Sparkline` and `LineChart` derive their SVG gradient ids from
 *     `React.useId()` rather than `Math.random()`. The random id differed
 *     between the server and client render passes and broke hydration on the
 *     `url(#…)` reference — invisible in a static prototype, fatal under SSR.
 *
 * Nothing else was rewritten. When the design system folder changes, re-copy
 * and re-apply those four.
 */

export { Button } from "./components/core/Button.jsx";
export { IconButton } from "./components/core/IconButton.jsx";
export { Icon } from "./components/core/Icon.jsx";
export { Badge } from "./components/core/Badge.jsx";
export { Tag } from "./components/core/Tag.jsx";
export { Card } from "./components/core/Card.jsx";
export { GlassPanel } from "./components/core/GlassPanel.jsx";

export { Input } from "./components/forms/Input.jsx";
export { Select } from "./components/forms/Select.jsx";
export { Checkbox } from "./components/forms/Checkbox.jsx";
export { Switch } from "./components/forms/Switch.jsx";

export { Tabs } from "./components/navigation/Tabs.jsx";
export { SegmentedControl } from "./components/navigation/SegmentedControl.jsx";
export { SidebarNav } from "./components/navigation/SidebarNav.jsx";

export { Dialog } from "./components/feedback/Dialog.jsx";
export { Tooltip } from "./components/feedback/Tooltip.jsx";
export { EmptyState } from "./components/feedback/EmptyState.jsx";

export { StatTile } from "./components/data/StatTile.jsx";
export { DeltaPill } from "./components/data/DeltaPill.jsx";
export { Sparkline } from "./components/data/Sparkline.jsx";
export { BarSeries } from "./components/data/BarSeries.jsx";
export { MetricBar } from "./components/data/MetricBar.jsx";
export { DataTable } from "./components/data/DataTable.jsx";

export { ChartFrame } from "./components/charts/ChartFrame.jsx";
export { Legend } from "./components/charts/Legend.jsx";
export { LineChart } from "./components/charts/LineChart.jsx";
export { StackedBars } from "./components/charts/StackedBars.jsx";
export { DonutChart } from "./components/charts/DonutChart.jsx";
export { FunnelChart } from "./components/charts/FunnelChart.jsx";
export { SankeyDiagram } from "./components/charts/SankeyDiagram.jsx";
export { HeatmapGrid } from "./components/charts/HeatmapGrid.jsx";
export { RetentionMatrix } from "./components/charts/RetentionMatrix.jsx";

/* @ds-bundle: {"format":4,"namespace":"FalorbDesignSystem_c510a5","components":[{"name":"ChartFrame","sourcePath":"components/charts/ChartFrame.jsx"},{"name":"DonutChart","sourcePath":"components/charts/DonutChart.jsx"},{"name":"FunnelChart","sourcePath":"components/charts/FunnelChart.jsx"},{"name":"HeatmapGrid","sourcePath":"components/charts/HeatmapGrid.jsx"},{"name":"Legend","sourcePath":"components/charts/Legend.jsx"},{"name":"LineChart","sourcePath":"components/charts/LineChart.jsx"},{"name":"RetentionMatrix","sourcePath":"components/charts/RetentionMatrix.jsx"},{"name":"SankeyDiagram","sourcePath":"components/charts/SankeyDiagram.jsx"},{"name":"StackedBars","sourcePath":"components/charts/StackedBars.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"GlassPanel","sourcePath":"components/core/GlassPanel.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"BarSeries","sourcePath":"components/data/BarSeries.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"DeltaPill","sourcePath":"components/data/DeltaPill.jsx"},{"name":"MetricBar","sourcePath":"components/data/MetricBar.jsx"},{"name":"Sparkline","sourcePath":"components/data/Sparkline.jsx"},{"name":"StatTile","sourcePath":"components/data/StatTile.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"SegmentedControl","sourcePath":"components/navigation/SegmentedControl.jsx"},{"name":"SidebarNav","sourcePath":"components/navigation/SidebarNav.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/charts/ChartFrame.jsx":"7ac90c37e727","components/charts/DonutChart.jsx":"03e633133f0c","components/charts/FunnelChart.jsx":"ceef4ba10026","components/charts/HeatmapGrid.jsx":"6c1d1615e2ca","components/charts/Legend.jsx":"372b4e283753","components/charts/LineChart.jsx":"027febb102d3","components/charts/RetentionMatrix.jsx":"96fd0091be7b","components/charts/SankeyDiagram.jsx":"c03c27077819","components/charts/StackedBars.jsx":"99664937439b","components/core/Badge.jsx":"fbf099dcb6c3","components/core/Button.jsx":"5d34ebb2cd0d","components/core/Card.jsx":"2892ba342c2b","components/core/GlassPanel.jsx":"563a5d06cdc2","components/core/Icon.jsx":"c6ab47deeeae","components/core/IconButton.jsx":"d66277513376","components/core/Tag.jsx":"5257707a55e7","components/data/BarSeries.jsx":"8adf86e8724b","components/data/DataTable.jsx":"2d7d8ec2a960","components/data/DeltaPill.jsx":"8f7f7f56eb14","components/data/MetricBar.jsx":"ca3500dc58eb","components/data/Sparkline.jsx":"c573538ba45b","components/data/StatTile.jsx":"e49e9a5e62cf","components/feedback/Dialog.jsx":"67a30dbcf88c","components/feedback/EmptyState.jsx":"1711148ef70e","components/feedback/Tooltip.jsx":"2af6cc13c4e6","components/forms/Checkbox.jsx":"18761d36c02e","components/forms/Input.jsx":"621f38801b46","components/forms/Select.jsx":"319aaacd3b4a","components/forms/Switch.jsx":"7224563712cb","components/navigation/SegmentedControl.jsx":"9df4c7a3e611","components/navigation/SidebarNav.jsx":"6fbf6cde9305","components/navigation/Tabs.jsx":"6d7b4d4e9f7f","ui_kits/dashboard/AppShell.jsx":"2e5baa787f2b","ui_kits/dashboard/OverviewScreen.jsx":"ef2cd88ee6d5","ui_kits/dashboard/PeopleScreen.jsx":"719ff02dfe47","ui_kits/dashboard/PersonScreen.jsx":"75ea8030b53e","ui_kits/dashboard/PropertyScreen.jsx":"1f56e7dcf79f","ui_kits/dashboard/SettingsScreen.jsx":"37fdc3204cd2","ui_kits/dashboard/ViewsScreen.jsx":"33807e1dc396","ui_kits/dashboard/charts-data.js":"23997db43cb9","ui_kits/dashboard/data.js":"681849ff1c4a","ui_kits/site/SiteHero.jsx":"45af871f2938","ui_kits/site/SiteSections.jsx":"0ad083d5aaad"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.FalorbDesignSystem_c510a5 = window.FalorbDesignSystem_c510a5 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/charts/ChartFrame.jsx
try { (() => {
/** Card shell shared by every chart: title, right-hand controls, legend, plot area. */
function ChartFrame({
  title,
  subtitle,
  actions,
  legend,
  height,
  tone = "card",
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      padding: "14px 16px 12px",
      background: tone === "panel" ? "var(--surface-panel)" : "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)",
      boxShadow: "var(--edge-top)",
      ...style
    }
  }, (title || actions) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-body-sm)",
      fontWeight: "var(--wt-semibold)",
      color: "var(--text-primary)"
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)"
    }
  }, subtitle)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 8,
      flex: "0 0 auto"
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: height,
      display: "flex",
      flexDirection: "column"
    }
  }, children), legend && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, legend));
}
Object.assign(__ds_scope, { ChartFrame });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/ChartFrame.jsx", error: String((e && e.message) || e) }); }

// components/charts/DonutChart.jsx
try { (() => {
/** Donut breakdown with a centred total and an optional right-hand value list. */
function DonutChart({
  segments = [],
  total,
  totalLabel = "Total",
  size = 148,
  thickness = 16,
  showList = true,
  style
}) {
  const [hover, setHover] = React.useState(null);
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 20,
      flex: 1,
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: size,
      height: size,
      flex: "0 0 auto"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      transform: "rotate(-90deg)"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--chart-track)",
    strokeWidth: thickness
  }), segments.map((s, i) => {
    const len = s.value / sum * c;
    const el = /*#__PURE__*/React.createElement("circle", {
      key: s.label,
      cx: size / 2,
      cy: size / 2,
      r: r,
      fill: "none",
      stroke: s.color || `var(--series-${i % 5 + 1})`,
      strokeWidth: hover === s.label ? thickness + 3 : thickness,
      strokeDasharray: `${Math.max(len - 1.5, 0)} ${c - Math.max(len - 1.5, 0)}`,
      strokeDashoffset: -offset,
      onMouseEnter: () => setHover(s.label),
      onMouseLeave: () => setHover(null),
      style: {
        transition: "stroke-width var(--dur-2) var(--ease-out)",
        cursor: "default"
      }
    });
    offset += len;
    return el;
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "grid",
      placeItems: "center",
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: 26,
      letterSpacing: "var(--ls-metric)",
      color: "var(--metric-fg)",
      lineHeight: 1
    }
  }, hover ? segments.find(s => s.label === hover).value.toLocaleString() : total ?? sum.toLocaleString()), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)"
    }
  }, hover || totalLabel))), showList && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gap: 7,
      minWidth: 0
    }
  }, segments.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s.label,
    onMouseEnter: () => setHover(s.label),
    onMouseLeave: () => setHover(null),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: "var(--size-body-sm)",
      color: hover === s.label ? "var(--text-primary)" : "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: s.color || `var(--series-${i % 5 + 1})`,
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, s.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      color: "var(--text-primary)"
    }
  }, Math.round(s.value / sum * 100), "%")))));
}
Object.assign(__ds_scope, { DonutChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/DonutChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/FunnelChart.jsx
try { (() => {
/** Step conversion. steps: [{ label, value }] — first step is 100%. Drop-off is shown per step. */
function FunnelChart({
  steps = [],
  height,
  style
}) {
  const first = steps[0]?.value || 1;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 6,
      flex: 1,
      alignContent: "start",
      minHeight: height,
      ...style
    }
  }, steps.map((s, i) => {
    const pct = s.value / first * 100;
    const drop = i ? (steps[i - 1].value - s.value) / steps[i - 1].value * 100 : 0;
    return /*#__PURE__*/React.createElement("div", {
      key: s.label,
      style: {
        display: "grid",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: "var(--size-body-sm)",
        color: "var(--text-body)"
      }
    }, s.label), i > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--size-micro)",
        color: "var(--signal-down)"
      }
    }, "\u2212", drop.toFixed(1), "%"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontFeatureSettings: "var(--tnum)",
        fontSize: "var(--size-body-sm)",
        color: "var(--text-primary)",
        fontWeight: "var(--wt-medium)",
        width: 68,
        textAlign: "right"
      }
    }, s.value.toLocaleString()), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--size-micro)",
        color: "var(--text-muted)",
        width: 44,
        textAlign: "right"
      }
    }, pct.toFixed(1), "%")), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 22,
        borderRadius: "var(--radius-2)",
        background: "var(--w-4)",
        backgroundImage: "var(--hatch)",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${pct}%`,
        height: "100%",
        borderRadius: "var(--radius-2)",
        background: i === 0 ? "var(--glacier-400)" : `color-mix(in oklab, var(--glacier-400) ${Math.max(100 - i * 16, 30)}%, var(--ink-600))`,
        transition: "width var(--dur-4) var(--ease-emphasis)"
      }
    })));
  }));
}
Object.assign(__ds_scope, { FunnelChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/FunnelChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/HeatmapGrid.jsx
try { (() => {
/**
 * Weekday × hour activity grid. rows: string[], cols: string[], values: number[][].
 * Intensity is glacier alpha, so it stays inside the monotone palette.
 */
function HeatmapGrid({
  rows = [],
  cols = [],
  values = [],
  cell = 14,
  gap = 3,
  format = v => v.toLocaleString(),
  style
}) {
  const [hover, setHover] = React.useState(null);
  const max = Math.max(...values.flat(), 1);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8,
      flex: 1,
      alignContent: "start",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap,
      gridTemplateColumns: `34px repeat(${cols.length}, minmax(0,1fr))`
    }
  }, rows.map((r, ri) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: r
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)",
      display: "flex",
      alignItems: "center"
    }
  }, r), cols.map((c, ci) => {
    const v = values[ri]?.[ci] ?? 0;
    const a = v / max;
    const on = hover && hover[0] === ri && hover[1] === ci;
    return /*#__PURE__*/React.createElement("span", {
      key: c,
      onMouseEnter: () => setHover([ri, ci]),
      onMouseLeave: () => setHover(null),
      title: `${r} ${c} · ${format(v)}`,
      style: {
        height: cell,
        borderRadius: 3,
        background: a === 0 ? "var(--w-2)" : `rgba(125,211,252,${(0.10 + a * 0.78).toFixed(3)})`,
        outline: on ? "1px solid var(--w-40)" : "none",
        transition: "outline-color var(--dur-1) var(--ease-out)"
      }
    });
  }))), /*#__PURE__*/React.createElement("span", null), cols.map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)",
      textAlign: "center",
      overflow: "hidden"
    }
  }, i % 2 === 0 ? c : ""))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      fontFamily: "var(--font-mono)",
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "0"), [0.1, 0.3, 0.5, 0.7, 0.88].map(a => /*#__PURE__*/React.createElement("span", {
    key: a,
    style: {
      width: 16,
      height: 8,
      borderRadius: 2,
      background: `rgba(125,211,252,${a})`
    }
  })), /*#__PURE__*/React.createElement("span", null, format(max)), hover && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      color: "var(--text-primary)"
    }
  }, rows[hover[0]], " ", cols[hover[1]], " \xB7 ", format(values[hover[0]][hover[1]]))));
}
Object.assign(__ds_scope, { HeatmapGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/HeatmapGrid.jsx", error: String((e && e.message) || e) }); }

// components/charts/Legend.jsx
try { (() => {
function Legend({
  items = [],
  compact = false,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: compact ? 12 : 16,
      ...style
    }
  }, items.map(it => /*#__PURE__*/React.createElement("span", {
    key: it.label,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: "var(--size-micro)",
      color: "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: it.shape === "line" ? 12 : 7,
      height: it.shape === "line" ? 2 : 7,
      borderRadius: it.shape === "line" ? 2 : 999,
      background: it.color || "var(--series-1)",
      backgroundImage: it.hatch ? "var(--hatch)" : undefined,
      flex: "0 0 auto"
    }
  }), it.label, it.value !== undefined && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      color: "var(--text-primary)"
    }
  }, it.value))));
}
Object.assign(__ds_scope, { Legend });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/Legend.jsx", error: String((e && e.message) || e) }); }

// components/charts/LineChart.jsx
try { (() => {
/**
 * Multi-series line / area chart with a y-axis, hairline grid, and a hover crosshair.
 * Series: [{ name, color, data: number[], fill?: boolean, dashed?: boolean }]
 */
function LineChart({
  series = [],
  labels = [],
  height = 200,
  yTicks = 4,
  format = v => v.toLocaleString(),
  onHover,
  showGrid = true,
  style
}) {
  const [idx, setIdx] = React.useState(null);
  const all = series.flatMap(s => s.data);
  const max = Math.max(...all, 1);
  const min = 0;
  const span = max - min || 1;
  const n = Math.max(...series.map(s => s.data.length), 1);
  const uid = React.useMemo(() => "lc" + Math.random().toString(36).slice(2, 8), []);
  const ticks = Array.from({
    length: yTicks + 1
  }, (_, i) => max - span / yTicks * i);
  const path = (data, close) => {
    const pts = data.map((d, i) => [i / Math.max(n - 1, 1) * 100, 100 - (d - min) / span * 100]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
    return close ? `${line} L100 100 L0 100 Z` : line;
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flex: 1,
      minHeight: height
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      flex: "0 0 auto",
      paddingBottom: 1
    }
  }, ticks.map((t, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)",
      lineHeight: 1,
      transform: "translateY(-3px)"
    }
  }, format(Math.round(t))))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: 1,
      minWidth: 0
    },
    onMouseLeave: () => {
      setIdx(null);
      onHover && onHover(null);
    },
    onMouseMove: e => {
      const r = e.currentTarget.getBoundingClientRect();
      const i = Math.round((e.clientX - r.left) / r.width * (n - 1));
      const c = Math.max(0, Math.min(n - 1, i));
      setIdx(c);
      onHover && onHover(c);
    }
  }, showGrid && ticks.map((t, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      top: `${i / yTicks * 100}%`,
      height: 1,
      background: "var(--grid-line)"
    }
  })), /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 100 100",
    preserveAspectRatio: "none",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      overflow: "visible"
    }
  }, /*#__PURE__*/React.createElement("defs", null, series.map((s, si) => /*#__PURE__*/React.createElement("linearGradient", {
    key: si,
    id: `${uid}-${si}`,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: s.color || "var(--series-1)",
    stopOpacity: "0.20"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: s.color || "var(--series-1)",
    stopOpacity: "0"
  })))), series.map((s, si) => s.fill && /*#__PURE__*/React.createElement("path", {
    key: "f" + si,
    d: path(s.data, true),
    fill: `url(#${uid}-${si})`
  })), series.map((s, si) => /*#__PURE__*/React.createElement("path", {
    key: "l" + si,
    d: path(s.data),
    fill: "none",
    stroke: s.color || "var(--series-1)",
    strokeWidth: 1.6,
    strokeDasharray: s.dashed ? "3 3" : undefined,
    vectorEffect: "non-scaling-stroke",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }))), idx !== null && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `${idx / Math.max(n - 1, 1) * 100}%`,
      width: 1,
      background: "var(--w-16)"
    }
  }), series.map((s, si) => /*#__PURE__*/React.createElement("span", {
    key: si,
    style: {
      position: "absolute",
      left: `${idx / Math.max(n - 1, 1) * 100}%`,
      top: `${100 - (s.data[idx] - min) / span * 100}%`,
      width: 7,
      height: 7,
      marginLeft: -3.5,
      marginTop: -3.5,
      borderRadius: 999,
      background: s.color || "var(--series-1)",
      boxShadow: "0 0 0 3px rgba(8,9,10,.8)"
    }
  }))))), labels.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      marginTop: 7,
      paddingLeft: 34
    }
  }, labels.map((l, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      flex: 1,
      textAlign: "center",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--size-micro)",
      color: idx === i ? "var(--text-primary)" : "var(--text-muted)"
    }
  }, l))));
}
Object.assign(__ds_scope, { LineChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/LineChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/RetentionMatrix.jsx
try { (() => {
/**
 * Cohort retention triangle. cohorts: [{ label, size, values: number[] }] where values are
 * percentages for week/day 0..n. Cells fade with intensity; empty future cells stay blank.
 */
function RetentionMatrix({
  cohorts = [],
  periodLabel = "Week",
  cellWidth = 52,
  style
}) {
  const width = Math.max(...cohorts.map(c => c.values.length), 1);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: "auto",
      flex: 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 3,
      gridTemplateColumns: `minmax(96px,1.2fr) 60px repeat(${width}, minmax(34px,${cellWidth}px))`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)"
    }
  }, "Cohort"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      textAlign: "right"
    }
  }, "People"), Array.from({
    length: width
  }, (_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)",
      textAlign: "center"
    }
  }, periodLabel[0], i)), cohorts.map(c => /*#__PURE__*/React.createElement(React.Fragment, {
    key: c.label
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-label)",
      color: "var(--text-body)",
      display: "flex",
      alignItems: "center"
    }
  }, c.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: "var(--size-label)",
      color: "var(--text-primary)",
      textAlign: "right",
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end"
    }
  }, c.size.toLocaleString()), Array.from({
    length: width
  }, (_, i) => {
    const v = c.values[i];
    if (v === undefined || v === null) return /*#__PURE__*/React.createElement("span", {
      key: i
    });
    const a = 0.08 + v / 100 * 0.72;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        height: 26,
        borderRadius: 3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `rgba(125,211,252,${a.toFixed(3)})`,
        color: v > 55 ? "var(--ink-1000)" : "var(--text-primary)",
        fontFamily: "var(--font-mono)",
        fontFeatureSettings: "var(--tnum)",
        fontSize: "var(--size-micro)"
      }
    }, v, "%");
  })))));
}
Object.assign(__ds_scope, { RetentionMatrix });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/RetentionMatrix.jsx", error: String((e && e.message) || e) }); }

// components/charts/SankeyDiagram.jsx
try { (() => {
/**
 * Sankey flow diagram — built for path analysis ("landing → property → action → exit").
 * nodes: [{ id, label, column, color? }]  links: [{ from, to, value }]
 * Layout is computed from the data: node value = max(inflow, outflow).
 */
function SankeyDiagram({
  nodes = [],
  links = [],
  height = 260,
  nodeWidth = 10,
  nodeGap = 14,
  format = v => v.toLocaleString(),
  style
}) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(680);
  const [hover, setHover] = React.useState(null);
  React.useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(es => setW(es[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const layout = React.useMemo(() => {
    const byId = {};
    nodes.forEach(n => byId[n.id] = {
      ...n,
      in: 0,
      out: 0
    });
    links.forEach(l => {
      if (byId[l.from]) byId[l.from].out += l.value;
      if (byId[l.to]) byId[l.to].in += l.value;
    });
    const list = Object.values(byId).map(n => ({
      ...n,
      value: Math.max(n.in, n.out)
    }));
    const cols = [...new Set(list.map(n => n.column))].sort((a, b) => a - b);
    const colW = cols.length > 1 ? (w - nodeWidth) / (cols.length - 1) : 0;
    const maxColSum = Math.max(...cols.map(c => list.filter(n => n.column === c).reduce((a, n) => a + n.value, 0)), 1);
    const maxCount = Math.max(...cols.map(c => list.filter(n => n.column === c).length), 1);
    const usable = height - nodeGap * (maxCount - 1);
    const scale = usable / maxColSum;
    const placed = {};
    cols.forEach(c => {
      const inCol = list.filter(n => n.column === c);
      const colHeight = inCol.reduce((a, n) => a + n.value * scale, 0) + nodeGap * (inCol.length - 1);
      let y = (height - colHeight) / 2;
      inCol.forEach(n => {
        const h = Math.max(n.value * scale, 2);
        placed[n.id] = {
          ...n,
          x: cols.indexOf(c) * colW,
          y,
          h
        };
        y += h + nodeGap;
      });
    });
    const cursor = {};
    const ribbons = links.map((l, i) => {
      const a = placed[l.from],
        b = placed[l.to];
      if (!a || !b) return null;
      const ka = "o" + l.from,
        kb = "i" + l.to;
      cursor[ka] = cursor[ka] || 0;
      cursor[kb] = cursor[kb] || 0;
      const th = Math.max(l.value * scale, 1.2);
      const y0 = a.y + cursor[ka],
        y1 = b.y + cursor[kb];
      cursor[ka] += th;
      cursor[kb] += th;
      const x0 = a.x + nodeWidth,
        x1 = b.x;
      const mx = (x0 + x1) / 2;
      const d = `M${x0} ${y0} C${mx} ${y0} ${mx} ${y1} ${x1} ${y1} L${x1} ${y1 + th} C${mx} ${y1 + th} ${mx} ${y0 + th} ${x0} ${y0 + th} Z`;
      return {
        id: i,
        d,
        link: l,
        color: a.color
      };
    }).filter(Boolean);
    return {
      placed: Object.values(placed),
      ribbons
    };
  }, [nodes, links, w, height, nodeWidth, nodeGap]);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative",
      flex: 1,
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "100%",
    height: height,
    style: {
      display: "block",
      overflow: "visible"
    }
  }, layout.ribbons.map(r => {
    const on = hover === r.id;
    return /*#__PURE__*/React.createElement("path", {
      key: r.id,
      d: r.d,
      fill: r.color || "var(--glacier-400)",
      fillOpacity: hover === null ? 0.13 : on ? 0.42 : 0.06,
      onMouseEnter: () => setHover(r.id),
      onMouseLeave: () => setHover(null),
      style: {
        transition: "fill-opacity var(--dur-2) var(--ease-out)"
      }
    });
  }), layout.placed.map(n => /*#__PURE__*/React.createElement("g", {
    key: n.id
  }, /*#__PURE__*/React.createElement("rect", {
    x: n.x,
    y: n.y,
    width: nodeWidth,
    height: n.h,
    rx: 3,
    fill: n.color || "var(--ink-200)"
  })))), layout.placed.map(n => {
    const lastCol = n.x > w - nodeWidth - 1;
    return /*#__PURE__*/React.createElement("div", {
      key: "l" + n.id,
      style: {
        position: "absolute",
        left: lastCol ? undefined : n.x + nodeWidth + 7,
        right: lastCol ? nodeWidth + 7 : undefined,
        top: n.y + n.h / 2,
        transform: "translateY(-50%)",
        display: "grid",
        gap: 1,
        pointerEvents: "none",
        textAlign: lastCol ? "right" : "left",
        maxWidth: 150
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "var(--size-label)",
        color: "var(--text-primary)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textShadow: "0 1px 4px rgba(5,6,7,.92)"
      }
    }, n.label), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontFeatureSettings: "var(--tnum)",
        fontSize: "var(--size-micro)",
        color: "var(--text-muted)",
        textShadow: "0 1px 4px rgba(5,6,7,.92)"
      }
    }, format(n.value)));
  }), hover !== null && layout.ribbons[hover] && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      right: 0,
      padding: "7px 10px",
      borderRadius: "var(--radius-2)",
      background: "var(--glass-bg)",
      border: "var(--glass-border)",
      backdropFilter: "var(--glass-blur)",
      WebkitBackdropFilter: "var(--glass-blur)",
      boxShadow: "var(--shadow-3)",
      pointerEvents: "none",
      fontSize: "var(--size-micro)",
      color: "var(--text-primary)",
      whiteSpace: "nowrap"
    }
  }, layout.ribbons[hover].link.from, " \u2192 ", layout.ribbons[hover].link.to, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      marginLeft: 8,
      color: "var(--glacier-300)"
    }
  }, format(layout.ribbons[hover].link.value))));
}
Object.assign(__ds_scope, { SankeyDiagram });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/SankeyDiagram.jsx", error: String((e && e.message) || e) }); }

// components/charts/StackedBars.jsx
try { (() => {
/**
 * Stacked column chart. data: [{ label, values: number[] }], series: [{ name, color }].
 * Unhovered columns keep the graphite ramp; the hovered column brightens its top segment.
 */
function StackedBars({
  data = [],
  series = [],
  height = 200,
  showAxis = true,
  onSelect,
  selected,
  style
}) {
  const [hover, setHover] = React.useState(null);
  const totals = data.map(d => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const active = hover ?? selected;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: 1,
      minHeight: height,
      display: "flex",
      alignItems: "flex-end",
      gap: 5
    }
  }, showAxis && [0, 0.25, 0.5, 0.75, 1].map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: `${t * 100}%`,
      height: 1,
      background: "var(--grid-line)"
    }
  })), data.map((d, i) => {
    const on = active === d.label;
    return /*#__PURE__*/React.createElement("div", {
      key: d.label,
      onMouseEnter: () => setHover(d.label),
      onMouseLeave: () => setHover(null),
      onClick: () => onSelect && onSelect(d.label),
      style: {
        position: "relative",
        flex: 1,
        height: `${totals[i] / max * 100}%`,
        display: "flex",
        flexDirection: "column-reverse",
        borderRadius: "var(--radius-2)",
        overflow: "hidden",
        cursor: onSelect ? "pointer" : "default",
        opacity: active && !on ? 0.55 : 1,
        transition: "opacity var(--dur-2) var(--ease-out)"
      }
    }, d.values.map((v, si) => /*#__PURE__*/React.createElement("span", {
      key: si,
      style: {
        height: `${v / (totals[i] || 1) * 100}%`,
        background: series[si]?.color || `var(--series-${si % 5 + 1})`,
        borderTop: si ? "1px solid rgba(8,9,10,.5)" : "none"
      }
    })));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      marginTop: 7
    }
  }, data.map(d => /*#__PURE__*/React.createElement("span", {
    key: d.label,
    style: {
      flex: 1,
      textAlign: "center",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--size-micro)",
      color: active === d.label ? "var(--text-primary)" : "var(--text-muted)"
    }
  }, d.label))));
}
Object.assign(__ds_scope, { StackedBars });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/StackedBars.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
const TONES = {
  neutral: {
    bg: "var(--w-6)",
    fg: "var(--text-secondary)",
    bd: "var(--w-8)"
  },
  accent: {
    bg: "rgba(125,211,252,.12)",
    fg: "var(--glacier-300)",
    bd: "rgba(125,211,252,.22)"
  },
  up: {
    bg: "var(--signal-up-dim)",
    fg: "var(--signal-up)",
    bd: "rgba(95,208,138,.22)"
  },
  down: {
    bg: "var(--signal-down-dim)",
    fg: "var(--signal-down)",
    bd: "rgba(242,116,139,.22)"
  },
  warn: {
    bg: "var(--signal-warn-dim)",
    fg: "var(--signal-warn)",
    bd: "rgba(233,184,114,.22)"
  },
  solid: {
    bg: "var(--ink-50)",
    fg: "var(--ink-1000)",
    bd: "transparent"
  }
};
function Badge({
  children,
  tone = "neutral",
  mono = false,
  dot = false,
  style
}) {
  const t = TONES[tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      height: 20,
      padding: "0 7px",
      borderRadius: "var(--radius-2)",
      background: t.bg,
      color: t.fg,
      border: `1px solid ${t.bd}`,
      fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      fontFeatureSettings: mono ? "var(--tnum)" : undefined,
      fontSize: "var(--size-micro)",
      fontWeight: "var(--wt-medium)",
      lineHeight: 1,
      whiteSpace: "nowrap",
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 5,
      borderRadius: 999,
      background: t.fg,
      flex: "0 0 auto"
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    height: 28,
    padX: 10,
    font: "var(--size-label)",
    gap: 6,
    radius: "var(--radius-3)"
  },
  md: {
    height: 34,
    padX: 12,
    font: "var(--size-body-sm)",
    gap: 7,
    radius: "var(--radius-control)"
  },
  lg: {
    height: 42,
    padX: 18,
    font: "var(--size-body)",
    gap: 8,
    radius: "var(--radius-control)"
  }
};
const VARIANTS = {
  primary: {
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-fg)",
    border: "1px solid transparent",
    boxShadow: "var(--shadow-2)",
    hover: {
      background: "var(--btn-primary-bg-hover)"
    }
  },
  secondary: {
    background: "var(--control-bg)",
    color: "var(--control-fg)",
    border: "1px solid var(--control-border)",
    boxShadow: "var(--edge-top)",
    hover: {
      background: "var(--control-bg-hover)"
    }
  },
  glass: {
    background: "var(--glass-bg)",
    color: "var(--text-primary)",
    border: "var(--glass-border)",
    backdropFilter: "var(--glass-blur)",
    WebkitBackdropFilter: "var(--glass-blur)",
    boxShadow: "var(--edge-top)",
    hover: {
      background: "var(--w-12)"
    }
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid transparent",
    hover: {
      background: "var(--surface-hover)",
      color: "var(--text-primary)"
    }
  },
  accent: {
    background: "var(--glacier-400)",
    color: "var(--ink-1000)",
    border: "1px solid transparent",
    boxShadow: "var(--shadow-2)",
    hover: {
      background: "var(--glacier-300)"
    }
  },
  danger: {
    background: "var(--signal-down-dim)",
    color: "var(--signal-down)",
    border: "1px solid rgba(242,116,139,.28)",
    hover: {
      background: "rgba(242,116,139,.18)"
    }
  }
};
function Button({
  children,
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  disabled = false,
  fullWidth = false,
  as = "button",
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const {
    hover: hoverStyle,
    ...base
  } = v;
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, _extends({
    disabled: Tag === "button" ? disabled : undefined,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      display: fullWidth ? "flex" : "inline-flex",
      width: fullWidth ? "100%" : undefined,
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.height,
      padding: `0 ${s.padX}px`,
      borderRadius: s.radius,
      fontFamily: "var(--font-sans)",
      fontSize: s.font,
      fontWeight: "var(--wt-medium)",
      letterSpacing: "var(--ls-body)",
      lineHeight: 1,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.38 : 1,
      whiteSpace: "nowrap",
      transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out)",
      transform: press && !disabled ? "translateY(0.5px) scale(0.994)" : "none",
      ...base,
      ...(hover && !disabled ? hoverStyle : null),
      ...style
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function Card({
  children,
  title,
  subtitle,
  action,
  padding,
  tone = "card",
  style,
  bodyStyle
}) {
  const bg = tone === "panel" ? "var(--surface-panel)" : tone === "raised" ? "var(--surface-raised)" : tone === "inset" ? "var(--surface-inset)" : "var(--surface-card)";
  const pad = padding ?? (tone === "panel" ? "var(--pad-panel)" : "var(--pad-card)");
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: "flex",
      flexDirection: "column",
      background: bg,
      border: "1px solid var(--border-subtle)",
      borderRadius: tone === "panel" ? "var(--radius-panel)" : "var(--radius-card)",
      boxShadow: "var(--shadow-2)",
      overflow: "hidden",
      ...style
    }
  }, (title || action) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      padding: `14px ${typeof pad === "number" ? pad + "px" : pad} 0`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: "var(--size-body)",
      fontWeight: "var(--wt-semibold)",
      color: "var(--text-primary)",
      letterSpacing: "var(--ls-body)"
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-label)",
      color: "var(--text-muted)"
    }
  }, subtitle)), action), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: pad,
      ...bodyStyle
    }
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/GlassPanel.jsx
try { (() => {
/** Frosted surface used for overlays that sit above data: tooltips, popovers, floating toolbars. */
function GlassPanel({
  children,
  heavy = false,
  radius = "var(--radius-panel)",
  padding = "var(--pad-panel)",
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--glass-bg)",
      border: "var(--glass-border)",
      borderRadius: radius,
      padding,
      backdropFilter: heavy ? "var(--glass-blur-heavy)" : "var(--glass-blur)",
      WebkitBackdropFilter: heavy ? "var(--glass-blur-heavy)" : "var(--glass-blur)",
      boxShadow: heavy ? "var(--shadow-4)" : "var(--shadow-3)",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { GlassPanel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/GlassPanel.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/**
 * Thin wrapper over the Lucide CDN sprite. Renders <i data-lucide="…"> and asks
 * Lucide to hydrate it. Requires the Lucide UMD script on the page.
 */
function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  color = "currentColor",
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let cancelled = false;
    const hydrate = () => {
      if (cancelled || !window.lucide || !host) return;
      host.innerHTML = `<i data-lucide="${name}"></i>`;
      window.lucide.createIcons({
        nameAttr: "data-lucide",
        attrs: {
          width: size,
          height: size,
          "stroke-width": strokeWidth,
          stroke: color
        },
        root: host
      });
    };
    hydrate();
    if (!window.lucide) {
      const t = setInterval(() => {
        if (window.lucide) {
          hydrate();
          clearInterval(t);
        }
      }, 60);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [name, size, strokeWidth, color]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: "inline-flex",
      width: size,
      height: size,
      flex: "0 0 auto",
      color,
      ...style
    }
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  active = false,
  disabled = false,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const dim = size === "sm" ? 28 : size === "lg" ? 40 : 34;
  const bg = variant === "glass" ? "var(--glass-bg)" : variant === "solid" ? "var(--control-bg)" : "transparent";
  return /*#__PURE__*/React.createElement("button", _extends({
    "aria-label": label,
    title: label,
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: dim,
      height: dim,
      borderRadius: "var(--radius-control)",
      border: variant === "ghost" ? "1px solid transparent" : "1px solid var(--control-border)",
      background: active ? "var(--surface-active)" : hover && !disabled ? "var(--surface-hover)" : bg,
      color: active ? "var(--text-primary)" : hover ? "var(--text-primary)" : "var(--text-secondary)",
      backdropFilter: variant === "glass" ? "var(--glass-blur)" : undefined,
      WebkitBackdropFilter: variant === "glass" ? "var(--glass-blur)" : undefined,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.38 : 1,
      transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)",
      ...style
    }
  }, rest), icon);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function Tag({
  children,
  onRemove,
  icon,
  active = false,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const interactive = !!onClick;
  return /*#__PURE__*/React.createElement("span", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 24,
      padding: onRemove ? "0 4px 0 9px" : "0 9px",
      borderRadius: "var(--radius-pill)",
      background: active ? "var(--surface-selected)" : hover && interactive ? "var(--control-bg-hover)" : "var(--control-bg)",
      border: `1px solid ${active ? "rgba(125,211,252,.28)" : "var(--control-border)"}`,
      color: active ? "var(--glacier-200)" : "var(--text-body)",
      fontSize: "var(--size-label)",
      fontWeight: "var(--wt-medium)",
      lineHeight: 1,
      cursor: interactive ? "pointer" : "default",
      transition: "background var(--dur-1) var(--ease-out)",
      ...style
    }
  }, icon, children, onRemove && /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onRemove();
    },
    "aria-label": "Remove",
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 16,
      height: 16,
      marginLeft: 1,
      padding: 0,
      border: "none",
      borderRadius: 999,
      background: "transparent",
      color: "var(--text-muted)",
      cursor: "pointer",
      fontSize: 12,
      lineHeight: 1
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/BarSeries.jsx
try { (() => {
/**
 * Column chart with Falorb's hatch-filled inactive bars and a solid highlight on the
 * hovered/selected column. Values are plain numbers; labels sit under the axis.
 */
function BarSeries({
  data = [],
  height = 180,
  selected,
  onSelect,
  color = "var(--series-1)",
  showAxis = true,
  style
}) {
  const [hover, setHover] = React.useState(null);
  const max = Math.max(...data.map(d => d.value), 1);
  const active = hover ?? selected;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height,
      display: "flex",
      alignItems: "flex-end",
      gap: 6
    }
  }, showAxis && [0, 0.5, 1].map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: `${t * 100}%`,
      height: 1,
      background: "var(--grid-line)"
    }
  })), data.map((d, i) => {
    const on = active === d.label;
    return /*#__PURE__*/React.createElement("div", {
      key: d.label,
      onMouseEnter: () => setHover(d.label),
      onMouseLeave: () => setHover(null),
      onClick: () => onSelect && onSelect(d.label),
      style: {
        position: "relative",
        flex: 1,
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        cursor: onSelect ? "pointer" : "default"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: "100%",
        height: `${Math.max(d.value / max * 100, 2)}%`,
        borderRadius: "var(--radius-2)",
        background: on ? color : "var(--w-4)",
        backgroundImage: on ? undefined : "var(--hatch)",
        borderTop: on ? "none" : `1.5px solid ${color}`,
        transition: "background var(--dur-2) var(--ease-out), height var(--dur-4) var(--ease-emphasis)"
      }
    }));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, data.map(d => /*#__PURE__*/React.createElement("span", {
    key: d.label,
    style: {
      flex: 1,
      textAlign: "center",
      fontSize: "var(--size-micro)",
      fontFamily: "var(--font-mono)",
      color: active === d.label ? "var(--text-primary)" : "var(--text-muted)",
      fontWeight: active === d.label ? "var(--wt-medium)" : "var(--wt-regular)",
      transition: "color var(--dur-1) var(--ease-out)"
    }
  }, d.label))));
}
Object.assign(__ds_scope, { BarSeries });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/BarSeries.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
/**
 * Dense data table. Columns: { key, header, width, align, mono, render }.
 * Header is sticky; rows are 38px (30px when dense) with a hairline separator.
 */
function DataTable({
  columns = [],
  rows = [],
  dense = false,
  onRowClick,
  selectedId,
  emptyState,
  style
}) {
  const h = dense ? "var(--row-height-dense)" : "var(--row-height)";
  const grid = columns.map(c => c.width || "1fr").join(" ");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: grid,
      alignItems: "center",
      gap: 12,
      height: 30,
      padding: "0 12px",
      borderBottom: "1px solid var(--border-subtle)",
      position: "sticky",
      top: 0,
      zIndex: 2,
      background: "var(--surface-panel)"
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("span", {
    key: c.key,
    style: {
      fontSize: "var(--size-micro)",
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: "var(--wt-medium)",
      textAlign: c.align || "left",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, c.header))), rows.length === 0 && emptyState, rows.map((r, i) => {
    const on = selectedId !== undefined && r.id === selectedId;
    return /*#__PURE__*/React.createElement("div", {
      key: r.id ?? i,
      onClick: () => onRowClick && onRowClick(r),
      style: {
        display: "grid",
        gridTemplateColumns: grid,
        alignItems: "center",
        gap: 12,
        minHeight: h,
        padding: "0 12px",
        borderBottom: "1px solid var(--grid-line)",
        background: on ? "var(--surface-selected)" : "transparent",
        cursor: onRowClick ? "pointer" : "default",
        transition: "background var(--dur-1) var(--ease-out)"
      },
      onMouseEnter: e => {
        if (!on) e.currentTarget.style.background = "var(--surface-hover)";
      },
      onMouseLeave: e => {
        if (!on) e.currentTarget.style.background = "transparent";
      }
    }, columns.map(c => /*#__PURE__*/React.createElement("span", {
      key: c.key,
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start",
        gap: 7,
        minWidth: 0,
        fontFamily: c.mono ? "var(--font-mono)" : "var(--font-sans)",
        fontFeatureSettings: c.mono ? "var(--tnum)" : undefined,
        fontSize: dense ? "var(--size-label)" : "var(--size-body-sm)",
        color: c.mono ? "var(--text-primary)" : "var(--text-body)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, c.render ? c.render(r) : r[c.key])));
  }));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/DeltaPill.jsx
try { (() => {
/** +/- change chip. The only place colour carries meaning in a Falorb metric block. */
function DeltaPill({
  value,
  invert = false,
  size = "md",
  showArrow = true,
  style
}) {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  const up = Number.isFinite(num) ? num >= 0 : String(value).trim().startsWith("+");
  const good = invert ? !up : up;
  const text = typeof value === "number" ? `${up ? "+" : ""}${value}%` : value;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      height: size === "sm" ? 18 : 22,
      padding: size === "sm" ? "0 6px" : "0 8px",
      borderRadius: "var(--radius-2)",
      background: good ? "var(--signal-up-dim)" : "var(--signal-down-dim)",
      color: good ? "var(--signal-up)" : "var(--signal-down)",
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: size === "sm" ? "var(--size-micro)" : "var(--size-label)",
      fontWeight: "var(--wt-medium)",
      lineHeight: 1,
      whiteSpace: "nowrap",
      ...style
    }
  }, showArrow && /*#__PURE__*/React.createElement("svg", {
    width: "9",
    height: "9",
    viewBox: "0 0 9 9",
    fill: "none",
    style: {
      transform: up ? "none" : "rotate(180deg)"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4.5 7.5V1.5M4.5 1.5L1.8 4.2M4.5 1.5l2.7 2.7",
    stroke: "currentColor",
    strokeWidth: "1.3",
    strokeLinecap: "round"
  })), text);
}
Object.assign(__ds_scope, { DeltaPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DeltaPill.jsx", error: String((e && e.message) || e) }); }

// components/data/MetricBar.jsx
try { (() => {
/** Horizontal share bar used in breakdown lists (top pages, referrers, countries). */
function MetricBar({
  label,
  value,
  share,
  meta,
  icon,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: "var(--row-height)",
      padding: "0 10px",
      borderRadius: "var(--radius-2)",
      overflow: "hidden",
      cursor: onClick ? "pointer" : "default",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: `${Math.min(share, 100)}%`,
      background: hover ? "rgba(125,211,252,.16)" : "var(--w-4)",
      borderRight: "1px solid var(--w-8)",
      transition: "background var(--dur-1) var(--ease-out), width var(--dur-4) var(--ease-emphasis)"
    }
  }), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      display: "inline-flex",
      color: "var(--text-muted)"
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      flex: 1,
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontSize: "var(--size-body-sm)",
      color: "var(--text-body)"
    }
  }, label), meta && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)"
    }
  }, meta), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: "var(--size-body-sm)",
      color: "var(--text-primary)",
      fontWeight: "var(--wt-medium)"
    }
  }, value));
}
Object.assign(__ds_scope, { MetricBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/MetricBar.jsx", error: String((e && e.message) || e) }); }

// components/data/Sparkline.jsx
try { (() => {
/** Filled area + line trend. Monotone by default; pass color for the highlighted series. */
function Sparkline({
  data = [],
  width,
  height = 32,
  color = "var(--series-1)",
  fill = true,
  strokeWidth = 1.4,
  style
}) {
  const w = 100;
  const h = 100;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((d, i) => [i / Math.max(data.length - 1, 1) * w, h - (d - min) / span * (h - 8) - 4]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const gid = React.useMemo(() => "sl" + Math.random().toString(36).slice(2, 8), []);
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: "none",
    style: {
      display: "block",
      width: width || "100%",
      height,
      overflow: "visible",
      ...style
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: gid,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: color,
    stopOpacity: "0.22"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: color,
    stopOpacity: "0"
  }))), fill && /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: `url(#${gid})`
  }), /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    vectorEffect: "non-scaling-stroke",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/data/StatTile.jsx
try { (() => {
/** The metric primitive: micro-label, oversized figure, delta, optional trend. */
function StatTile({
  label,
  value,
  unit,
  delta,
  invertDelta = false,
  series,
  footnote,
  size = "md",
  bordered = true,
  style
}) {
  const fs = size === "lg" ? "var(--size-metric-xl)" : size === "sm" ? "var(--size-metric-md)" : "var(--size-metric-lg)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8,
      padding: bordered ? "14px 16px" : 0,
      borderRadius: "var(--radius-card)",
      background: bordered ? "var(--surface-card)" : "transparent",
      border: bordered ? "1px solid var(--border-subtle)" : "none",
      boxShadow: bordered ? "var(--edge-top)" : "none",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: "var(--wt-medium)"
    }
  }, label), delta !== undefined && /*#__PURE__*/React.createElement(__ds_scope.DeltaPill, {
    value: delta,
    invert: invertDelta,
    size: "sm"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: fs,
      fontWeight: "var(--wt-medium)",
      letterSpacing: "var(--ls-metric)",
      lineHeight: 1,
      color: "var(--metric-fg)"
    }
  }, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-body-sm)",
      color: "var(--text-muted)"
    }
  }, unit)), series && /*#__PURE__*/React.createElement(__ds_scope.Sparkline, {
    data: series,
    height: 28
  }), footnote && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)"
    }
  }, footnote));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function Dialog({
  open = true,
  title,
  subtitle,
  children,
  footer,
  onClose,
  width = 480,
  style
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      zIndex: 100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(5,6,7,.62)",
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)"
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width,
      maxWidth: "92%",
      background: "var(--glass-bg)",
      border: "var(--glass-border)",
      borderRadius: "var(--radius-panel)",
      backdropFilter: "var(--glass-blur-heavy)",
      WebkitBackdropFilter: "var(--glass-blur-heavy)",
      boxShadow: "var(--shadow-4)",
      animation: "falorb-dialog-in var(--dur-3) var(--ease-emphasis)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("style", null, "@keyframes falorb-dialog-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}"), /*#__PURE__*/React.createElement("header", {
    style: {
      padding: "18px 20px 0",
      display: "grid",
      gap: 3
    }
  }, title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: "var(--size-subtitle)",
      color: "var(--text-primary)",
      fontWeight: "var(--wt-semibold)",
      letterSpacing: "var(--ls-title)"
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: "var(--size-body-sm)",
      color: "var(--text-muted)"
    }
  }, subtitle)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 20px",
      fontSize: "var(--size-body-sm)",
      color: "var(--text-body)"
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: 8,
      padding: "0 20px 18px"
    }
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
function EmptyState({
  icon,
  title,
  body,
  action,
  dense = false,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      justifyItems: "center",
      gap: 8,
      padding: dense ? "22px 16px" : "44px 24px",
      textAlign: "center",
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 34,
      height: 34,
      marginBottom: 2,
      borderRadius: "var(--radius-control)",
      background: "var(--w-4)",
      border: "1px solid var(--border-subtle)",
      color: "var(--text-muted)"
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--size-body-sm)",
      fontWeight: "var(--wt-semibold)",
      color: "var(--text-primary)"
    }
  }, title), body && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      maxWidth: 320,
      fontSize: "var(--size-label)",
      color: "var(--text-muted)",
      lineHeight: "var(--lh-normal)"
    }
  }, body), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
/** Glass tooltip. Also the chart hover card — pass `rows` for the label/value list form. */
function Tooltip({
  children,
  label,
  rows,
  side = "top",
  open,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const show = open ?? hover;
  const pos = side === "bottom" ? {
    top: "calc(100% + 8px)",
    left: "50%",
    transform: "translateX(-50%)"
  } : side === "left" ? {
    right: "calc(100% + 8px)",
    top: "50%",
    transform: "translateY(-50%)"
  } : side === "right" ? {
    left: "calc(100% + 8px)",
    top: "50%",
    transform: "translateY(-50%)"
  } : {
    bottom: "calc(100% + 8px)",
    left: "50%",
    transform: "translateX(-50%)"
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      display: "inline-flex"
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false)
  }, children, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      zIndex: 60,
      ...pos,
      minWidth: rows ? 196 : undefined,
      padding: rows ? "10px 12px" : "6px 9px",
      borderRadius: rows ? "var(--radius-card)" : "var(--radius-2)",
      background: "var(--glass-bg)",
      border: "var(--glass-border)",
      backdropFilter: "var(--glass-blur)",
      WebkitBackdropFilter: "var(--glass-blur)",
      boxShadow: "var(--shadow-3)",
      color: "var(--text-primary)",
      fontSize: "var(--size-label)",
      whiteSpace: rows ? "normal" : "nowrap",
      opacity: show ? 1 : 0,
      pointerEvents: "none",
      transition: "opacity var(--dur-2) var(--ease-out)",
      ...style
    }
  }, rows ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "grid",
      gap: 7
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)"
    }
  }, label), rows.map(r => /*#__PURE__*/React.createElement("span", {
    key: r.label,
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: r.color || "var(--series-1)"
    }
  }), r.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      color: "var(--text-primary)",
      fontWeight: "var(--wt-medium)"
    }
  }, r.value)))) : label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: description ? "flex-start" : "center",
      gap: 9,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 16,
      height: 16,
      flex: "0 0 auto",
      marginTop: description ? 1 : 0,
      borderRadius: "var(--radius-1)",
      background: checked ? "var(--glacier-400)" : "var(--surface-inset)",
      border: `1px solid ${checked ? "var(--glacier-400)" : "var(--control-border)"}`,
      boxShadow: "var(--edge-top)",
      transition: "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out)"
    }
  }, checked && /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 10 10",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 5.2l2 2L8 3",
    stroke: "var(--ink-1000)",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), (label || description) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "grid",
      gap: 2
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-body-sm)",
      color: "var(--text-body)"
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)"
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  value,
  onChange,
  placeholder,
  label,
  hint,
  iconLeft,
  suffix,
  size = "md",
  mono = false,
  invalid = false,
  disabled = false,
  style,
  inputStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "sm" ? 28 : size === "lg" ? 42 : 34;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "grid",
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-label)",
      color: "var(--text-secondary)",
      fontWeight: "var(--wt-medium)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      height: h,
      padding: "0 10px",
      borderRadius: "var(--radius-control)",
      background: "var(--surface-inset)",
      border: `1px solid ${invalid ? "rgba(242,116,139,.5)" : focus ? "rgba(125,211,252,.45)" : "var(--control-border)"}`,
      boxShadow: focus ? "var(--focus-ring)" : "var(--edge-top)",
      opacity: disabled ? 0.45 : 1,
      transition: "border-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out)"
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      display: "inline-flex"
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--text-primary)",
      fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      fontFeatureSettings: mono ? "var(--tnum)" : undefined,
      fontSize: size === "sm" ? "var(--size-label)" : "var(--size-body-sm)",
      letterSpacing: "var(--ls-body)",
      ...inputStyle
    }
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      color: "var(--text-muted)",
      fontFamily: "var(--font-mono)"
    }
  }, suffix)), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-micro)",
      color: invalid ? "var(--signal-down)" : "var(--text-muted)"
    }
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
/** Compact dropdown. Bare variant is the inline "All accounts ⌄" filter used in page headers. */
function Select({
  value,
  options = [],
  onChange,
  size = "md",
  variant = "control",
  label,
  style
}) {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const away = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const h = size === "sm" ? 28 : size === "lg" ? 42 : 34;
  const bare = variant === "bare";
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative",
      display: "inline-grid",
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-label)",
      color: "var(--text-secondary)"
    }
  }, label), /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(o => !o),
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: h,
      padding: bare ? "0 2px" : "0 10px",
      borderRadius: "var(--radius-control)",
      background: bare ? "transparent" : hover ? "var(--control-bg-hover)" : "var(--control-bg)",
      border: bare ? "1px solid transparent" : "1px solid var(--control-border)",
      color: bare && !hover ? "var(--text-body)" : "var(--text-primary)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--size-body-sm)",
      fontWeight: "var(--wt-medium)",
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)"
    }
  }, value, /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 10 10",
    fill: "none",
    style: {
      opacity: 0.6,
      transform: open ? "rotate(180deg)" : "none",
      transition: "transform var(--dur-2) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 4l3 3 3-3",
    stroke: "currentColor",
    strokeWidth: "1.4",
    strokeLinecap: "round"
  }))), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: `calc(100% + 6px)`,
      left: 0,
      zIndex: 40,
      minWidth: 168,
      padding: 4,
      borderRadius: "var(--radius-card)",
      background: "var(--glass-bg)",
      border: "var(--glass-border)",
      backdropFilter: "var(--glass-blur-heavy)",
      WebkitBackdropFilter: "var(--glass-blur-heavy)",
      boxShadow: "var(--shadow-4)"
    }
  }, options.map(o => /*#__PURE__*/React.createElement("div", {
    key: o,
    onClick: () => {
      onChange && onChange(o);
      setOpen(false);
    },
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "7px 9px",
      borderRadius: "var(--radius-2)",
      background: o === value ? "var(--surface-selected)" : "transparent",
      color: o === value ? "var(--glacier-200)" : "var(--text-body)",
      fontSize: "var(--size-body-sm)",
      cursor: "pointer"
    },
    onMouseEnter: e => {
      if (o !== value) e.currentTarget.style.background = "var(--surface-hover)";
    },
    onMouseLeave: e => {
      if (o !== value) e.currentTarget.style.background = "transparent";
    }
  }, o, o === value && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11
    }
  }, "\u2713")))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function Switch({
  checked = false,
  onChange,
  label,
  size = "md",
  disabled = false,
  style
}) {
  const w = size === "sm" ? 28 : 34;
  const h = size === "sm" ? 16 : 20;
  const k = h - 6;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 9,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      position: "relative",
      display: "inline-block",
      width: w,
      height: h,
      flex: "0 0 auto",
      borderRadius: "var(--radius-pill)",
      background: checked ? "var(--glacier-400)" : "var(--w-8)",
      border: `1px solid ${checked ? "var(--glacier-400)" : "var(--control-border)"}`,
      boxShadow: "var(--edge-top)",
      transition: "background var(--dur-2) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: checked ? w - k - 4 : 2,
      width: k,
      height: k,
      borderRadius: 999,
      background: checked ? "var(--ink-1000)" : "var(--ink-200)",
      transition: "left var(--dur-2) var(--ease-emphasis), background var(--dur-2) var(--ease-out)"
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--size-body-sm)",
      color: "var(--text-body)"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SegmentedControl.jsx
try { (() => {
/** Range / granularity switcher. Sliding glass thumb, never a hard jump. */
function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  fullWidth = false,
  style
}) {
  const h = size === "sm" ? 26 : 32;
  const i = Math.max(0, options.indexOf(value));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: fullWidth ? "grid" : "inline-grid",
      gridAutoFlow: "column",
      gridAutoColumns: "1fr",
      width: fullWidth ? "100%" : undefined,
      padding: 2,
      height: h + 4,
      borderRadius: "var(--radius-control)",
      background: "var(--surface-inset)",
      border: "1px solid var(--control-border)",
      boxShadow: "var(--edge-top)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      bottom: 2,
      left: `calc(${i * 100 / options.length}% + 2px)`,
      width: `calc(${100 / options.length}% - 4px)`,
      borderRadius: "var(--radius-3)",
      background: "var(--w-8)",
      border: "1px solid var(--w-8)",
      backdropFilter: "var(--glass-blur)",
      WebkitBackdropFilter: "var(--glass-blur)",
      transition: "left var(--dur-3) var(--ease-emphasis)"
    }
  }), options.map(o => {
    const on = o === value;
    return /*#__PURE__*/React.createElement("button", {
      key: o,
      onClick: () => onChange && onChange(o),
      style: {
        position: "relative",
        zIndex: 1,
        height: h,
        padding: "0 12px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: on ? "var(--text-primary)" : "var(--text-muted)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--size-label)",
        fontWeight: on ? "var(--wt-semibold)" : "var(--wt-medium)",
        whiteSpace: "nowrap",
        transition: "color var(--dur-2) var(--ease-out)"
      }
    }, o);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarNav.jsx
try { (() => {
/** Left rail for the Falorb dashboard: sections of rows, each optionally with a trailing figure. */
function SidebarNav({
  sections = [],
  value,
  onChange,
  footer,
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-8)",
      ...style
    }
  }, sections.map((sec, si) => /*#__PURE__*/React.createElement("div", {
    key: sec.label || si,
    style: {
      display: "grid",
      gap: 2
    }
  }, sec.label && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 10px 6px",
      fontSize: "var(--size-micro)",
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: "var(--wt-medium)"
    }
  }, sec.label), sec.items.map(it => {
    const on = it.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      onClick: () => onChange && onChange(it.value),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        height: 32,
        padding: "0 10px",
        borderRadius: "var(--radius-3)",
        border: "1px solid " + (on ? "rgba(125,211,252,.16)" : "transparent"),
        background: on ? "var(--surface-selected)" : "transparent",
        color: on ? "var(--glacier-100)" : "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--size-body-sm)",
        fontWeight: on ? "var(--wt-medium)" : "var(--wt-regular)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)"
      },
      onMouseEnter: e => {
        if (!on) {
          e.currentTarget.style.background = "var(--surface-hover)";
          e.currentTarget.style.color = "var(--text-primary)";
        }
      },
      onMouseLeave: e => {
        if (!on) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
        }
      }
    }, it.icon, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, it.label), it.meta !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontFeatureSettings: "var(--tnum)",
        fontSize: "var(--size-micro)",
        color: "var(--text-muted)"
      }
    }, it.meta));
  }))), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto"
    }
  }, footer));
}
Object.assign(__ds_scope, { SidebarNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/** Underline tabs — the primary in-page view switcher (Summary / Sessions / People …). */
function Tabs({
  tabs = [],
  value,
  onChange,
  size = "md",
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "stretch",
      gap: size === "sm" ? 16 : 22,
      borderBottom: "1px solid var(--border-subtle)",
      ...style
    }
  }, tabs.map(t => {
    const key = typeof t === "string" ? t : t.value;
    const label = typeof t === "string" ? t : t.label;
    const count = typeof t === "string" ? undefined : t.count;
    const on = key === value;
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      onClick: () => onChange && onChange(key),
      style: {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: size === "sm" ? "0 0 9px" : "0 0 12px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: on ? "var(--text-primary)" : "var(--text-muted)",
        fontFamily: "var(--font-sans)",
        fontSize: size === "sm" ? "var(--size-body-sm)" : "var(--size-body)",
        fontWeight: on ? "var(--wt-semibold)" : "var(--wt-medium)",
        letterSpacing: "var(--ls-body)",
        transition: "color var(--dur-1) var(--ease-out)"
      },
      onMouseEnter: e => {
        if (!on) e.currentTarget.style.color = "var(--text-body)";
      },
      onMouseLeave: e => {
        if (!on) e.currentTarget.style.color = "var(--text-muted)";
      }
    }, label, count !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontFeatureSettings: "var(--tnum)",
        fontSize: "var(--size-micro)",
        color: "var(--text-muted)"
      }
    }, count), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -1,
        height: 1.5,
        background: on ? "var(--ink-50)" : "transparent",
        transition: "background var(--dur-3) var(--ease-out)"
      }
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/AppShell.jsx
try { (() => {
const {
  Icon,
  IconButton,
  Button,
  SidebarNav,
  Select,
  Input
} = window.FalorbDesignSystem_c510a5;
function Wordmark() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "2px 10px 14px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 22,
      height: 22,
      borderRadius: 6,
      background: "var(--ink-50)",
      color: "var(--ink-1000)",
      fontWeight: 600,
      fontSize: 13,
      letterSpacing: "-.04em"
    }
  }, "F"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: "-.03em",
      color: "var(--text-primary)"
    }
  }, "Falorb"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      color: "var(--text-muted)"
    }
  }, "v2.4"));
}
function AccountFooter() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8,
      paddingTop: 12,
      borderTop: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 10px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 22,
      height: 22,
      borderRadius: 999,
      background: "var(--ink-700)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      color: "var(--text-body)",
      fontWeight: 600
    }
  }, "EP"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "grid"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-body)"
    }
  }, "Emma Parson"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "var(--text-muted)",
      fontFamily: "var(--font-mono)"
    }
  }, "self-hosted \xB7 eu-central"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 5,
      padding: "0 10px 2px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 10,
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "Event storage"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, "41.2 / 100 GB")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 3,
      borderRadius: 999,
      background: "var(--w-6)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "41%",
      height: "100%",
      background: "var(--glacier-400)"
    }
  }))));
}
function TopBar({
  title,
  meta,
  right
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      height: 52,
      padding: "0 var(--pad-panel)",
      borderBottom: "1px solid var(--border-subtle)",
      flex: "0 0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 10,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: "-.022em",
      color: "var(--text-primary)",
      whiteSpace: "nowrap"
    }
  }, title), meta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, meta)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, right));
}
function AppShell({
  view,
  onView,
  properties,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      display: "flex",
      gap: "var(--gutter-panel)",
      padding: "var(--shell-pad)",
      background: "var(--bg-app)",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      flex: "0 0 224px",
      display: "flex",
      flexDirection: "column",
      padding: 10,
      background: "var(--surface-panel)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-shell)",
      boxShadow: "var(--shadow-2)"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, null), /*#__PURE__*/React.createElement(SidebarNav, {
    value: view,
    onChange: onView,
    style: {
      flex: 1
    },
    sections: [{
      items: [{
        value: "overview",
        label: "All properties",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "layout-grid",
          size: 15
        })
      }, {
        value: "people",
        label: "People",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "users",
          size: 15
        }),
        meta: "1,284"
      }, {
        value: "views",
        label: "Custom views",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "layout-dashboard",
          size: 15
        }),
        meta: "4"
      }, {
        value: "events",
        label: "Live events",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "activity",
          size: 15
        }),
        meta: "42/s"
      }]
    }, {
      label: "Properties",
      items: properties.slice(0, 5).map(p => ({
        value: "prop:" + p.id,
        label: p.domain,
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "globe",
          size: 15
        }),
        meta: p.visitors.split(",")[0] + "k"
      }))
    }, {
      label: "Instance",
      items: [{
        value: "settings",
        label: "Settings",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "settings",
          size: 15
        })
      }, {
        value: "health",
        label: "Health",
        icon: /*#__PURE__*/React.createElement(Icon, {
          name: "heart-pulse",
          size: 15
        })
      }]
    }]
  }), /*#__PURE__*/React.createElement(AccountFooter, null)), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      background: "var(--surface-panel)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-shell)",
      boxShadow: "var(--shadow-3)",
      overflow: "hidden",
      position: "relative"
    }
  }, children));
}
Object.assign(window, {
  AppShell,
  TopBar,
  Wordmark,
  AccountFooter
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/OverviewScreen.jsx
try { (() => {
const {
  StatTile,
  Sparkline,
  DeltaPill,
  SegmentedControl,
  Select,
  Button,
  Icon,
  IconButton,
  Card
} = window.FalorbDesignSystem_c510a5;
function PropertyRow({
  p,
  onOpen
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: () => onOpen(p.id),
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "grid",
      gridTemplateColumns: "1.5fr 120px 1fr 96px 88px 24px",
      alignItems: "center",
      gap: 14,
      padding: "12px 14px",
      cursor: "pointer",
      background: hover ? "var(--surface-hover)" : "var(--surface-card)",
      border: "1px solid " + (hover ? "var(--border-default)" : "var(--border-subtle)"),
      borderRadius: "var(--radius-card)",
      transition: "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      fontSize: 13,
      fontWeight: 500,
      color: "var(--text-primary)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "globe",
    size: 13
  }), p.domain), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, p.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: 17,
      letterSpacing: "-.03em",
      color: "var(--metric-fg)"
    }
  }, p.visitors), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)"
    }
  }, "visitors")), /*#__PURE__*/React.createElement(Sparkline, {
    data: p.series,
    height: 34,
    color: hover ? "var(--glacier-400)" : "var(--series-2)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: "right",
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: 13,
      color: "var(--text-body)"
    }
  }, p.sessions), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      justifyContent: "flex-end"
    }
  }, /*#__PURE__*/React.createElement(DeltaPill, {
    value: p.delta,
    size: "sm"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      color: hover ? "var(--text-primary)" : "var(--text-muted)",
      display: "inline-flex",
      justifyContent: "flex-end"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 15
  })));
}
function OverviewScreen({
  properties,
  onOpen,
  range,
  onRange
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "All properties",
    meta: "6 tracked \xB7 42 events/s",
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SegmentedControl, {
      options: ["24h", "7d", "30d", "12m"],
      value: range,
      onChange: onRange,
      size: "sm"
    }), /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      value: "Visitors",
      options: ["Visitors", "Sessions", "Events"],
      onChange: () => {}
    }), /*#__PURE__*/React.createElement(IconButton, {
      label: "Export CSV",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "download",
        size: 15
      })
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto",
      padding: "var(--pad-panel)",
      display: "grid",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Unique visitors",
    value: "89,736",
    delta: 9.4,
    size: "lg",
    series: [12, 15, 14, 19, 22, 21, 27, 26, 31, 34]
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Sessions",
    value: "150,172",
    delta: 6.1,
    size: "lg"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Median session",
    value: "1m 48s",
    delta: 2.2,
    size: "lg"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Tracker payload",
    value: "1.94",
    unit: "KB",
    size: "lg",
    footnote: "gzipped \xB7 no cookies"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, "Properties"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, "sorted by visitors \u2193")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 6
    }
  }, properties.map(p => /*#__PURE__*/React.createElement(PropertyRow, {
    key: p.id,
    p: p,
    onOpen: onOpen
  }))))));
}
Object.assign(window, {
  OverviewScreen,
  PropertyRow
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/OverviewScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/PeopleScreen.jsx
try { (() => {
const {
  DataTable,
  Input,
  Select,
  Checkbox,
  Button,
  IconButton,
  Icon,
  Badge,
  Tag,
  EmptyState,
  DeltaPill
} = window.FalorbDesignSystem_c510a5;
function FilterBar({
  query,
  onQuery,
  ident,
  onIdent
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px var(--pad-panel)",
      borderBottom: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement(Input, {
    size: "sm",
    value: query,
    onChange: e => onQuery(e.target.value),
    placeholder: "Search people, emails, IDs\u2026",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 13
    }),
    suffix: "\u2318K",
    style: {
      width: 280
    }
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    value: "All properties",
    options: ["All properties", "falorb.io", "docs.falorb.io", "app.falorb.io"],
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    value: "Last 30 days",
    options: ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 12 months"],
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Checkbox, {
    checked: ident,
    onChange: onIdent,
    label: "Identified only"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "download",
      size: 13
    })
  }, "Export")));
}
function PeopleScreen({
  people,
  onOpen
}) {
  const [query, setQuery] = React.useState("");
  const [ident, setIdent] = React.useState(false);
  const rows = people.filter(p => (!ident || p.ident) && p.handle.toLowerCase().includes(query.toLowerCase()));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "People",
    meta: rows.length + " of 1,284 · person-level detail on",
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Tag, {
      active: true,
      onClick: () => {}
    }, "returning"), /*#__PURE__*/React.createElement(IconButton, {
      label: "Columns",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "columns-3",
        size: 15
      })
    }))
  }), /*#__PURE__*/React.createElement(FilterBar, {
    query: query,
    onQuery: setQuery,
    ident: ident,
    onIdent: setIdent
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto"
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: rows,
    onRowClick: r => onOpen(r.id),
    emptyState: /*#__PURE__*/React.createElement(EmptyState, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "search-x",
        size: 16
      }),
      title: "No people match this search",
      body: "Clear the search, or widen the range to 12 months.",
      action: /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "secondary",
        onClick: () => {
          setQuery("");
          setIdent(false);
        }
      }, "Reset filters")
    }),
    columns: [{
      key: "handle",
      header: "Person",
      width: "1.6fr",
      render: r => /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 999,
          background: r.ident ? "rgba(125,211,252,.14)" : "var(--w-6)",
          color: r.ident ? "var(--glacier-300)" : "var(--text-muted)",
          flex: "0 0 auto"
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: r.ident ? "user-check" : "user",
        size: 12
      })), /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }
      }, r.handle))
    }, {
      key: "props",
      header: "Properties",
      width: "1.1fr",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "flex",
          gap: 4,
          overflow: "hidden"
        }
      }, r.props.map(x => /*#__PURE__*/React.createElement(Badge, {
        key: x,
        tone: "neutral"
      }, x)))
    }, {
      key: "sessions",
      header: "Sessions",
      width: "86px",
      align: "right",
      mono: true
    }, {
      key: "events",
      header: "Events",
      width: "80px",
      align: "right",
      mono: true
    }, {
      key: "country",
      header: "Geo",
      width: "60px",
      align: "center",
      mono: true
    }, {
      key: "device",
      header: "Device",
      width: "1fr"
    }, {
      key: "last",
      header: "Last seen",
      width: "100px",
      align: "right"
    }]
  })));
}
Object.assign(window, {
  PeopleScreen,
  FilterBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/PeopleScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/PersonScreen.jsx
try { (() => {
const {
  StatTile,
  Badge,
  Button,
  IconButton,
  Icon,
  Sparkline,
  Tabs,
  Dialog,
  Input,
  GlassPanel
} = window.FalorbDesignSystem_c510a5;
function TimelineRow({
  e,
  first
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "grid",
      gridTemplateColumns: "84px 20px 1fr 84px",
      alignItems: "start",
      gap: 12,
      padding: "9px 12px",
      borderRadius: "var(--radius-2)",
      background: hover ? "var(--surface-hover)" : "transparent",
      transition: "background var(--dur-1) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)",
      paddingTop: 2
    }
  }, e.time), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      display: "flex",
      justifyContent: "center",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 6,
      width: 7,
      height: 7,
      borderRadius: 999,
      background: first ? "var(--glacier-400)" : "var(--ink-500)",
      boxShadow: first ? "0 0 0 3px rgba(125,211,252,.16)" : "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 15,
      bottom: -14,
      width: 1,
      background: "var(--w-8)"
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "grid",
      gap: 2,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--text-primary)"
    }
  }, e.event), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, e.prop)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-secondary)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, e.detail)), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: "right",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)",
      paddingTop: 2
    }
  }, e.dur));
}
function AttrRow({
  k,
  v,
  mono = true
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      padding: "7px 0",
      borderBottom: "1px solid var(--grid-line)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-muted)"
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      fontSize: 12,
      color: "var(--text-primary)",
      textAlign: "right"
    }
  }, v));
}
function PersonScreen({
  person,
  timeline,
  onBack
}) {
  const [tab, setTab] = React.useState("Timeline");
  const [merge, setMerge] = React.useState(false);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: person.handle,
    meta: person.ident ? "identified" : "anonymous",
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "arrow-left",
        size: 13
      }),
      onClick: onBack
    }, "People"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "git-merge",
        size: 13
      }),
      onClick: () => setMerge(true)
    }, "Merge profile"), /*#__PURE__*/React.createElement(IconButton, {
      label: "Delete person data",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "trash-2",
        size: 15
      })
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto",
      display: "grid",
      gridTemplateColumns: "1fr 288px",
      gap: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 14,
      padding: "var(--pad-panel)",
      alignContent: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Sessions",
    value: String(person.sessions),
    delta: 12.5
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Events",
    value: String(person.events),
    delta: 6.2
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Properties seen",
    value: String(person.props.length),
    footnote: "across your portfolio"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    size: "sm",
    tabs: ["Timeline", "Sessions", "Attributes"],
    value: tab,
    onChange: setTab,
    style: {
      flex: 1
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)",
      padding: 6
    }
  }, timeline.map((e, i) => /*#__PURE__*/React.createElement(TimelineRow, {
    key: i,
    e: e,
    first: i === 0
  })))), /*#__PURE__*/React.createElement("aside", {
    style: {
      borderLeft: "1px solid var(--border-subtle)",
      padding: "var(--pad-panel)",
      display: "grid",
      gap: 16,
      alignContent: "start",
      background: "var(--ink-950)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, "Identity"), /*#__PURE__*/React.createElement(AttrRow, {
    k: "Person ID",
    v: person.id === "p1" ? "8f21c4d0e5" : "b7710ac332"
  }), /*#__PURE__*/React.createElement(AttrRow, {
    k: "First seen",
    v: person.first
  }), /*#__PURE__*/React.createElement(AttrRow, {
    k: "Last seen",
    v: person.last
  }), /*#__PURE__*/React.createElement(AttrRow, {
    k: "Country",
    v: person.country
  }), /*#__PURE__*/React.createElement(AttrRow, {
    k: "Device",
    v: person.device,
    mono: false
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, "Activity, 12 months"), /*#__PURE__*/React.createElement(Sparkline, {
    data: [1, 2, 1, 4, 3, 6, 5, 9, 7, 12, 10, 14],
    height: 44
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, "Properties"), person.props.map(p => /*#__PURE__*/React.createElement("div", {
    key: p,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "globe",
    size: 13
  }), p))))), /*#__PURE__*/React.createElement(Dialog, {
    open: merge,
    onClose: () => setMerge(false),
    title: "Merge into another profile",
    subtitle: "Events move to the target person. This cannot be undone.",
    width: 420,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      onClick: () => setMerge(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "sm",
      onClick: () => setMerge(false)
    }, "Merge"))
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Target person ID or email",
    mono: true,
    placeholder: "maya@northvolt.dev"
  })));
}
Object.assign(window, {
  PersonScreen,
  TimelineRow,
  AttrRow
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/PersonScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/PropertyScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  StatTile,
  BarSeries,
  MetricBar,
  Tabs,
  SegmentedControl,
  Select,
  Card,
  Button,
  Icon,
  IconButton,
  Tag,
  Badge,
  GlassPanel,
  ChartFrame,
  Legend,
  LineChart,
  StackedBars,
  DonutChart,
  FunnelChart,
  SankeyDiagram,
  HeatmapGrid,
  RetentionMatrix
} = window.FalorbDesignSystem_c510a5;
function BreakdownCard({
  title,
  rows,
  tabs,
  tab,
  onTab
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)",
      boxShadow: "var(--edge-top)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 12px 0"
    }
  }, tabs ? /*#__PURE__*/React.createElement(Tabs, {
    size: "sm",
    tabs: tabs,
    value: tab,
    onChange: onTab,
    style: {
      flex: 1,
      border: "none"
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      fontWeight: 600,
      color: "var(--text-primary)"
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 1,
      padding: "8px 6px 6px"
    }
  }, rows.map(r => /*#__PURE__*/React.createElement(MetricBar, _extends({
    key: r.label
  }, r, {
    onClick: () => {}
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 12px 10px"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 13
    })
  }, "Show all")));
}
function SummaryTab({
  property,
  months,
  pages,
  referrers,
  countries
}) {
  const [month, setMonth] = React.useState("Jun");
  const [srcTab, setSrcTab] = React.useState("Referrers");
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 268px",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      padding: "16px 16px 12px",
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)",
      boxShadow: "var(--edge-top)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: "var(--text-primary)"
    }
  }, "Visitors by month"), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    value: "Visitors",
    options: ["Visitors", "Sessions", "Events"],
    onChange: () => {}
  })), /*#__PURE__*/React.createElement(BarSeries, {
    data: months,
    selected: month,
    onSelect: setMonth,
    height: "100%",
    style: {
      flex: 1,
      minHeight: 168,
      gridTemplateRows: "1fr auto"
    }
  }), /*#__PURE__*/React.createElement(GlassPanel, {
    padding: 12,
    radius: "var(--radius-card)",
    style: {
      position: "absolute",
      top: 58,
      left: "56%",
      minWidth: 188,
      pointerEvents: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)",
      marginBottom: 8
    }
  }, month, " 2026"), [["Visitors", "33,801", "var(--series-1)"], ["Sessions", "41,209", "var(--series-2)"]].map(([l, v, c]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 18,
      marginTop: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: c
    }
  }), l), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: 12,
      fontWeight: 500,
      color: "var(--text-primary)"
    }
  }, v))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 10,
      alignContent: "start"
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Unique visitors",
    value: property.visitors,
    delta: property.delta
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Sessions",
    value: property.sessions,
    delta: 4.8
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Bounce rate",
    value: property.bounce,
    delta: -3.1,
    invertDelta: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(BreakdownCard, {
    title: "Top pages",
    rows: pages
  }), /*#__PURE__*/React.createElement(BreakdownCard, {
    tabs: ["Referrers", "Campaigns"],
    tab: srcTab,
    onTab: setSrcTab,
    rows: srcTab === "Referrers" ? referrers : referrers.slice(1)
  }), /*#__PURE__*/React.createElement(BreakdownCard, {
    title: "Countries",
    rows: countries
  })));
}
function TrendTab({
  C
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Visitors vs sessions",
    subtitle: "Last 12 months \xB7 monthly granularity",
    height: 220,
    actions: /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      value: "Monthly",
      options: ["Daily", "Weekly", "Monthly"],
      onChange: () => {}
    }),
    legend: /*#__PURE__*/React.createElement(Legend, {
      items: [{
        label: "Visitors",
        shape: "line"
      }, {
        label: "Sessions",
        shape: "line",
        color: "var(--series-2)"
      }]
    })
  }, /*#__PURE__*/React.createElement(LineChart, {
    labels: C.months,
    height: 220,
    series: [{
      name: "Visitors",
      data: C.visitors,
      fill: true
    }, {
      name: "Sessions",
      data: C.sessions,
      color: "var(--series-2)"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.3fr 1fr",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Traffic by source",
    subtitle: "Stacked, monthly",
    height: 180,
    legend: /*#__PURE__*/React.createElement(Legend, {
      items: C.sourceSeries.map(s => ({
        label: s.name,
        color: s.color
      }))
    })
  }, /*#__PURE__*/React.createElement(StackedBars, {
    data: C.sourceStack,
    series: C.sourceSeries,
    height: 180
  })), /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Sessions by device",
    height: 180
  }, /*#__PURE__*/React.createElement(DonutChart, {
    segments: C.devices,
    totalLabel: "Sessions",
    size: 150
  }))));
}
function PathsTab({
  C
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Path across properties",
    subtitle: "Entry source \u2192 property \u2192 action, last 30 days",
    height: 280,
    actions: /*#__PURE__*/React.createElement(SegmentedControl, {
      size: "sm",
      options: ["Sessions", "People"],
      value: "Sessions",
      onChange: () => {}
    })
  }, /*#__PURE__*/React.createElement(SankeyDiagram, {
    nodes: C.sankeyNodes,
    links: C.sankeyLinks,
    height: 280
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Docs \u2192 first event",
    subtitle: "Conversion funnel",
    height: 170
  }, /*#__PURE__*/React.createElement(FunnelChart, {
    steps: C.funnel
  })), /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Activity by hour",
    subtitle: "Weekday \xD7 hour, sessions",
    height: 170
  }, /*#__PURE__*/React.createElement(HeatmapGrid, {
    rows: C.days,
    cols: C.hours,
    values: C.heat
  }))));
}
function RetentionTab({
  C
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Weekly retention",
    subtitle: "Share of each cohort seen again in later weeks",
    height: 230,
    actions: /*#__PURE__*/React.createElement(SegmentedControl, {
      size: "sm",
      options: ["Weekly", "Monthly"],
      value: "Weekly",
      onChange: () => {}
    })
  }, /*#__PURE__*/React.createElement(RetentionMatrix, {
    cohorts: C.cohorts,
    periodLabel: "Week"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Returning vs new",
    height: 170,
    legend: /*#__PURE__*/React.createElement(Legend, {
      items: [{
        label: "Returning",
        shape: "line"
      }, {
        label: "New",
        shape: "line",
        color: "var(--series-2)"
      }]
    })
  }, /*#__PURE__*/React.createElement(LineChart, {
    labels: C.months,
    height: 170,
    series: [{
      name: "Returning",
      data: C.visitors.map(v => Math.round(v * 0.42)),
      fill: true
    }, {
      name: "New",
      data: C.visitors.map(v => Math.round(v * 0.58)),
      color: "var(--series-2)"
    }]
  })), /*#__PURE__*/React.createElement(ChartFrame, {
    title: "Sessions by browser",
    height: 170
  }, /*#__PURE__*/React.createElement(DonutChart, {
    segments: C.browsers,
    totalLabel: "Sessions",
    size: 140
  }))));
}
function PropertyScreen({
  property,
  months,
  pages,
  referrers,
  countries,
  onPeople
}) {
  const [tab, setTab] = React.useState("Summary");
  const [range, setRange] = React.useState("12m");
  const C = window.FALORB_CHARTS;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: property.domain,
    meta: property.label,
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Tag, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "filter",
        size: 12
      }),
      onRemove: () => {}
    }, "country = DE"), /*#__PURE__*/React.createElement(SegmentedControl, {
      options: ["24h", "7d", "30d", "12m"],
      value: range,
      onChange: setRange,
      size: "sm"
    }), /*#__PURE__*/React.createElement(IconButton, {
      label: "Snippet",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "code",
        size: 15
      })
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 var(--pad-panel)",
      borderBottom: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    tabs: ["Summary", "Trends", "Paths", {
      value: "People",
      label: "People",
      count: "1,284"
    }, "Retention"],
    value: tab,
    onChange: t => t === "People" ? onPeople() : setTab(t)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto",
      padding: "var(--pad-panel)",
      display: "grid",
      gap: 14,
      alignContent: "start"
    }
  }, tab === "Summary" && /*#__PURE__*/React.createElement(SummaryTab, {
    property: property,
    months: months,
    pages: pages,
    referrers: referrers,
    countries: countries
  }), tab === "Trends" && /*#__PURE__*/React.createElement(TrendTab, {
    C: C
  }), tab === "Paths" && /*#__PURE__*/React.createElement(PathsTab, {
    C: C
  }), tab === "Retention" && /*#__PURE__*/React.createElement(RetentionTab, {
    C: C
  })));
}
Object.assign(window, {
  PropertyScreen,
  BreakdownCard,
  SummaryTab,
  TrendTab,
  PathsTab,
  RetentionTab
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/PropertyScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/SettingsScreen.jsx
try { (() => {
const {
  Input,
  Switch,
  Checkbox,
  Select,
  Button,
  Icon,
  IconButton,
  Badge,
  Card,
  Tabs,
  StatTile
} = window.FalorbDesignSystem_c510a5;
const SNIPPET = `<script defer src="https://falorb.io/f.js"
  data-property="falorb.io"></script>`;
function Field({
  label,
  hint,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "220px 1fr",
      gap: 20,
      padding: "14px 0",
      borderBottom: "1px solid var(--grid-line)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--text-primary)",
      fontWeight: 500
    }
  }, label), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)",
      lineHeight: 1.45
    }
  }, hint)), /*#__PURE__*/React.createElement("div", null, children));
}
function SettingsScreen() {
  const [tab, setTab] = React.useState("Tracking");
  const [dnt, setDnt] = React.useState(true);
  const [person, setPerson] = React.useState(true);
  const [sample, setSample] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "Settings",
    meta: "self-hosted \xB7 eu-central \xB7 Postgres 16",
    right: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary"
    }, "Save changes")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 var(--pad-panel)",
      borderBottom: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    tabs: ["Tracking", "Privacy", "Storage", "Members", "API"],
    value: tab,
    onChange: setTab
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto",
      padding: "var(--pad-panel)",
      display: "grid",
      gap: 18,
      alignContent: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Tracker payload",
    value: "1.94",
    unit: "KB",
    footnote: "gzipped, no cookies"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Ingest p95",
    value: "41",
    unit: "ms",
    delta: -8.2,
    invertDelta: true
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Retained events",
    value: "8.4M",
    footnote: "41.2 GB of 100 GB"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)",
      padding: "4px 16px 16px"
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Tracker snippet",
    hint: "Paste before </head>. One property per snippet."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("pre", {
    style: {
      margin: 0,
      padding: "12px 14px",
      background: "var(--surface-inset)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-3)",
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      lineHeight: 1.55,
      color: "var(--glacier-200)",
      overflowX: "auto"
    }
  }, SNIPPET), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: copied ? "check" : "clipboard",
      size: 13
    }),
    onClick: () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }, copied ? "Copied" : "Copy snippet"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "external-link",
      size: 13
    })
  }, "Install docs")))), /*#__PURE__*/React.createElement(Field, {
    label: "Property domain",
    hint: "Used to scope events and block spoofed traffic."
  }, /*#__PURE__*/React.createElement(Input, {
    mono: true,
    size: "sm",
    value: "falorb.io",
    onChange: () => {},
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "globe",
      size: 13
    }),
    style: {
      maxWidth: 320
    }
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Person-level detail",
    hint: "Stores a first-party identifier so a visitor's history joins across properties."
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: person,
    onChange: setPerson,
    label: person ? "On" : "Off"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Do Not Track",
    hint: "Events are dropped at the edge, before the ingest queue."
  }, /*#__PURE__*/React.createElement(Checkbox, {
    checked: dnt,
    onChange: setDnt,
    label: "Respect the DNT header"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Sampling",
    hint: "Applies only above 1M events per day."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    checked: sample,
    onChange: setSample,
    label: "Sample high-volume properties",
    description: "Keeps p95 query time under 200ms on modest hardware."
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    value: "1 in 10",
    options: ["1 in 2", "1 in 10", "1 in 100"],
    onChange: () => {}
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Retention",
    hint: "Older events are deleted nightly. Aggregates are kept forever."
  }, /*#__PURE__*/React.createElement(Input, {
    mono: true,
    size: "sm",
    value: "730",
    suffix: "days",
    onChange: () => {},
    style: {
      maxWidth: 160
    }
  })))));
}
Object.assign(window, {
  SettingsScreen,
  Field
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/ViewsScreen.jsx
try { (() => {
const {
  ChartFrame,
  Legend,
  LineChart,
  StackedBars,
  DonutChart,
  FunnelChart,
  SankeyDiagram,
  HeatmapGrid,
  RetentionMatrix,
  BarSeries,
  MetricBar,
  StatTile,
  DataTable,
  Select,
  SegmentedControl,
  Button,
  IconButton,
  Icon,
  Tag,
  Badge,
  Dialog,
  Input,
  Checkbox,
  EmptyState,
  Tooltip
} = window.FalorbDesignSystem_c510a5;
const CHART_TYPES = ["Line", "Bars", "Stacked", "Donut", "Funnel", "Sankey", "Heatmap", "Cohorts", "Table"];
const CHART_ICON = {
  Line: "trending-up",
  Bars: "bar-chart-3",
  Stacked: "layers",
  Donut: "pie-chart",
  Funnel: "filter",
  Sankey: "git-fork",
  Heatmap: "grid-3x3",
  Cohorts: "table-2",
  Table: "list"
};
const SAVED_VIEWS = [{
  id: "v1",
  name: "Portfolio weekly",
  widgets: 5
}, {
  id: "v2",
  name: "Docs → install",
  widgets: 3
}, {
  id: "v3",
  name: "DE cohort",
  widgets: 4
}, {
  id: "v4",
  name: "Weekend traffic",
  widgets: 2
}];
function ChartBody({
  type,
  C
}) {
  switch (type) {
    case "Line":
      return /*#__PURE__*/React.createElement(LineChart, {
        labels: C.months,
        height: 168,
        series: [{
          name: "Visitors",
          data: C.visitors,
          fill: true
        }, {
          name: "Sessions",
          data: C.sessions,
          color: "var(--series-2)"
        }]
      });
    case "Bars":
      return /*#__PURE__*/React.createElement(BarSeries, {
        data: C.months.map((m, i) => ({
          label: m,
          value: C.visitors[i]
        })),
        selected: "Jun",
        height: "100%",
        style: {
          flex: 1,
          minHeight: 168,
          gridTemplateRows: "1fr auto"
        }
      });
    case "Stacked":
      return /*#__PURE__*/React.createElement(StackedBars, {
        data: C.sourceStack,
        series: C.sourceSeries,
        height: 168
      });
    case "Donut":
      return /*#__PURE__*/React.createElement(DonutChart, {
        segments: C.devices,
        totalLabel: "Sessions",
        size: 140
      });
    case "Funnel":
      return /*#__PURE__*/React.createElement(FunnelChart, {
        steps: C.funnel
      });
    case "Sankey":
      return /*#__PURE__*/React.createElement(SankeyDiagram, {
        nodes: C.sankeyNodes,
        links: C.sankeyLinks,
        height: 230
      });
    case "Heatmap":
      return /*#__PURE__*/React.createElement(HeatmapGrid, {
        rows: C.days,
        cols: C.hours,
        values: C.heat
      });
    case "Cohorts":
      return /*#__PURE__*/React.createElement(RetentionMatrix, {
        cohorts: C.cohorts.slice(0, 4),
        periodLabel: "Week"
      });
    case "Table":
      return /*#__PURE__*/React.createElement(DataTable, {
        dense: true,
        rows: C.months.slice(6).map((m, i) => ({
          id: m,
          month: m,
          visitors: C.visitors[i + 6].toLocaleString() + "k",
          sessions: C.sessions[i + 6].toLocaleString() + "k",
          bounce: (38 - i).toFixed(1) + "%"
        })),
        columns: [{
          key: "month",
          header: "Month",
          width: "1fr"
        }, {
          key: "visitors",
          header: "Visitors",
          width: "90px",
          align: "right",
          mono: true
        }, {
          key: "sessions",
          header: "Sessions",
          width: "90px",
          align: "right",
          mono: true
        }, {
          key: "bounce",
          header: "Bounce",
          width: "80px",
          align: "right",
          mono: true
        }]
      });
    default:
      return null;
  }
}
function Widget({
  w,
  C,
  onType,
  onSpan,
  onRemove
}) {
  const legend = w.type === "Line" ? /*#__PURE__*/React.createElement(Legend, {
    items: [{
      label: "Visitors",
      shape: "line"
    }, {
      label: "Sessions",
      shape: "line",
      color: "var(--series-2)"
    }]
  }) : w.type === "Stacked" ? /*#__PURE__*/React.createElement(Legend, {
    items: C.sourceSeries.map(s => ({
      label: s.name,
      color: s.color
    }))
  }) : null;
  return /*#__PURE__*/React.createElement(ChartFrame, {
    title: w.title,
    subtitle: w.dimension,
    height: w.type === "Sankey" ? 230 : 168,
    legend: legend,
    style: {
      gridColumn: w.span === 2 ? "span 2" : "span 1"
    },
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      value: w.type,
      options: CHART_TYPES,
      onChange: t => onType(w.id, t)
    }), /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: w.span === 2 ? "Make half width" : "Make full width",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: w.span === 2 ? "chevrons-right-left" : "chevrons-left-right",
        size: 14
      }),
      onClick: () => onSpan(w.id)
    }), /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: "Remove widget",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "x",
        size: 14
      }),
      onClick: () => onRemove(w.id)
    }))
  }, /*#__PURE__*/React.createElement(ChartBody, {
    type: w.type,
    C: C
  }));
}
function AddWidgetTile({
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      minHeight: 168,
      display: "grid",
      placeItems: "center",
      gap: 8,
      borderRadius: "var(--radius-card)",
      border: `1px dashed ${hover ? "rgba(125,211,252,.45)" : "var(--border-default)"}`,
      background: hover ? "var(--surface-selected)" : "transparent",
      color: hover ? "var(--glacier-200)" : "var(--text-muted)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      transition: "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 18
  }), "Add widget");
}
function ViewsScreen() {
  const C = window.FALORB_CHARTS;
  const [view, setView] = React.useState("v1");
  const [dirty, setDirty] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState({
    metric: "Visitors",
    dimension: "Month",
    type: "Line",
    title: ""
  });
  const [widgets, setWidgets] = React.useState([{
    id: 1,
    title: "Visitors vs sessions",
    dimension: "Month · all properties",
    type: "Line",
    span: 2
  }, {
    id: 2,
    title: "Traffic by source",
    dimension: "Month · stacked",
    type: "Stacked",
    span: 1
  }, {
    id: 3,
    title: "Sessions by device",
    dimension: "Share of total",
    type: "Donut",
    span: 1
  }, {
    id: 4,
    title: "Path across properties",
    dimension: "Entry → property → action",
    type: "Sankey",
    span: 2
  }, {
    id: 5,
    title: "Activity by hour",
    dimension: "Weekday × hour",
    type: "Heatmap",
    span: 1
  }, {
    id: 6,
    title: "Docs → first event",
    dimension: "Conversion",
    type: "Funnel",
    span: 1
  }]);
  const mutate = fn => {
    setDirty(true);
    fn();
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    title: "Custom views",
    meta: widgets.length + " widgets" + (dirty ? " · unsaved" : ""),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, dirty && /*#__PURE__*/React.createElement(Badge, {
      tone: "warn",
      dot: true
    }, "unsaved"), /*#__PURE__*/React.createElement(SegmentedControl, {
      size: "sm",
      options: ["24h", "7d", "30d", "12m"],
      value: "12m",
      onChange: () => {}
    }), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary",
      iconLeft: /*#__PURE__*/React.createElement(Icon, {
        name: "share-2",
        size: 13
      })
    }, "Share"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      onClick: () => setDirty(false)
    }, "Save view"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px var(--pad-panel)",
      borderBottom: "1px solid var(--border-subtle)"
    }
  }, SAVED_VIEWS.map(v => /*#__PURE__*/React.createElement(Tag, {
    key: v.id,
    active: v.id === view,
    onClick: () => setView(v.id)
  }, v.name)), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 13
    })
  }, "New view"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    variant: "bare",
    value: "All properties",
    options: ["All properties", "falorb.io", "docs.falorb.io", "app.falorb.io"],
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Tag, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "filter",
      size: 12
    }),
    onRemove: () => {}
  }, "country = DE"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto",
      padding: "var(--pad-panel)"
    }
  }, widgets.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "layout-dashboard",
      size: 16
    }),
    title: "This view is empty",
    body: "Add a widget to start. Every widget is a metric, a dimension, and a chart type \u2014 change any of the three later.",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary",
      onClick: () => setAdding(true)
    }, "Add widget")
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14,
      alignContent: "start"
    }
  }, widgets.map(w => /*#__PURE__*/React.createElement(Widget, {
    key: w.id,
    w: w,
    C: C,
    onType: (id, t) => mutate(() => setWidgets(ws => ws.map(x => x.id === id ? {
      ...x,
      type: t
    } : x))),
    onSpan: id => mutate(() => setWidgets(ws => ws.map(x => x.id === id ? {
      ...x,
      span: x.span === 2 ? 1 : 2
    } : x))),
    onRemove: id => mutate(() => setWidgets(ws => ws.filter(x => x.id !== id)))
  })), /*#__PURE__*/React.createElement(AddWidgetTile, {
    onClick: () => setAdding(true)
  }))), /*#__PURE__*/React.createElement(Dialog, {
    open: adding,
    onClose: () => setAdding(false),
    title: "Add widget",
    subtitle: "Pick a metric and a dimension, then choose how to draw it.",
    width: 460,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      onClick: () => setAdding(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "sm",
      onClick: () => {
        mutate(() => setWidgets(ws => [...ws, {
          id: Date.now(),
          title: draft.title || `${draft.metric} by ${draft.dimension.toLowerCase()}`,
          dimension: `${draft.dimension} · custom`,
          type: draft.type,
          span: draft.type === "Sankey" ? 2 : 1
        }]));
        setAdding(false);
      }
    }, "Add to view"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "Metric",
    value: draft.metric,
    options: ["Visitors", "Sessions", "Events", "Bounce rate", "Median session"],
    onChange: v => setDraft({
      ...draft,
      metric: v
    })
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Dimension",
    value: draft.dimension,
    options: ["Month", "Day", "Source", "Country", "Device", "Page", "Cohort"],
    onChange: v => setDraft({
      ...draft,
      dimension: v
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-secondary)",
      fontWeight: 500
    }
  }, "Chart type"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6
    }
  }, CHART_TYPES.map(t => /*#__PURE__*/React.createElement(Tag, {
    key: t,
    active: draft.type === t,
    onClick: () => setDraft({
      ...draft,
      type: t
    }),
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: CHART_ICON[t],
      size: 12
    })
  }, t)))), /*#__PURE__*/React.createElement(Input, {
    label: "Title",
    placeholder: `${draft.metric} by ${draft.dimension.toLowerCase()}`,
    value: draft.title,
    onChange: e => setDraft({
      ...draft,
      title: e.target.value
    })
  }), /*#__PURE__*/React.createElement(Checkbox, {
    checked: true,
    onChange: () => {},
    label: "Inherit this view's filters",
    description: "country = DE and the current range apply to the new widget."
  }))));
}
Object.assign(window, {
  ViewsScreen,
  Widget,
  ChartBody,
  AddWidgetTile
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/ViewsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/charts-data.js
try { (() => {
window.FALORB_CHARTS = {
  months: ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
  visitors: [26, 31, 29, 22, 34, 38, 36, 44, 41, 49, 46, 54],
  sessions: [38, 44, 41, 33, 48, 53, 50, 61, 57, 66, 63, 72],
  sourceStack: [{
    label: "Sep",
    values: [12, 9, 5]
  }, {
    label: "Oct",
    values: [14, 11, 6]
  }, {
    label: "Nov",
    values: [13, 10, 6]
  }, {
    label: "Dec",
    values: [10, 8, 4]
  }, {
    label: "Jan",
    values: [16, 12, 6]
  }, {
    label: "Feb",
    values: [18, 13, 7]
  }, {
    label: "Mar",
    values: [17, 13, 6]
  }, {
    label: "Apr",
    values: [21, 15, 8]
  }, {
    label: "May",
    values: [19, 14, 8]
  }, {
    label: "Jun",
    values: [23, 17, 9]
  }, {
    label: "Jul",
    values: [21, 16, 9]
  }, {
    label: "Aug",
    values: [25, 19, 10]
  }],
  sourceSeries: [{
    name: "Direct",
    color: "var(--series-1)"
  }, {
    name: "Search",
    color: "var(--series-2)"
  }, {
    name: "Social",
    color: "var(--series-4)"
  }],
  devices: [{
    label: "Desktop",
    value: 61
  }, {
    label: "Mobile",
    value: 31
  }, {
    label: "Tablet",
    value: 8
  }],
  browsers: [{
    label: "Chrome",
    value: 44
  }, {
    label: "Firefox",
    value: 27
  }, {
    label: "Safari",
    value: 21
  }, {
    label: "Edge",
    value: 8
  }],
  funnel: [{
    label: "Viewed pricing",
    value: 8412
  }, {
    label: "Opened docs",
    value: 3110
  }, {
    label: "Copied snippet",
    value: 1204
  }, {
    label: "First event received",
    value: 702
  }],
  sankeyNodes: [{
    id: "search",
    label: "Search",
    column: 0
  }, {
    id: "hn",
    label: "Hacker News",
    column: 0
  }, {
    id: "direct",
    label: "Direct",
    column: 0
  }, {
    id: "marketing",
    label: "falorb.io",
    column: 1
  }, {
    id: "docs",
    label: "docs.falorb.io",
    column: 1
  }, {
    id: "snippet",
    label: "Copied snippet",
    column: 2
  }, {
    id: "signup",
    label: "Created instance",
    column: 2
  }, {
    id: "exit",
    label: "Left",
    column: 2
  }],
  sankeyLinks: [{
    from: "search",
    to: "docs",
    value: 6209
  }, {
    from: "search",
    to: "marketing",
    value: 2100
  }, {
    from: "hn",
    to: "marketing",
    value: 5338
  }, {
    from: "hn",
    to: "docs",
    value: 1200
  }, {
    from: "direct",
    to: "marketing",
    value: 3800
  }, {
    from: "marketing",
    to: "snippet",
    value: 2400
  }, {
    from: "marketing",
    to: "signup",
    value: 940
  }, {
    from: "marketing",
    to: "exit",
    value: 7898
  }, {
    from: "docs",
    to: "snippet",
    value: 4100
  }, {
    from: "docs",
    to: "signup",
    value: 1180
  }, {
    from: "docs",
    to: "exit",
    value: 2129
  }],
  hours: ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"],
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  heat: [[4, 3, 2, 6, 22, 41, 52, 58, 49, 33, 18, 9], [5, 3, 2, 7, 24, 44, 55, 61, 51, 35, 19, 10], [4, 2, 2, 6, 26, 46, 57, 62, 53, 36, 20, 11], [5, 3, 3, 8, 25, 43, 54, 59, 50, 34, 21, 12], [6, 4, 3, 7, 21, 38, 47, 44, 36, 27, 22, 15], [8, 6, 4, 5, 11, 17, 21, 24, 22, 20, 17, 12], [7, 5, 3, 4, 9, 14, 19, 22, 20, 18, 14, 10]],
  cohorts: [{
    label: "Jul 7 – Jul 13",
    size: 1180,
    values: [100, 39, 28, 22, 19, 17]
  }, {
    label: "Jul 14 – Jul 20",
    size: 1284,
    values: [100, 42, 31, 24, 21]
  }, {
    label: "Jul 21 – Jul 27",
    size: 1102,
    values: [100, 38, 29, 22]
  }, {
    label: "Jul 28 – Aug 3",
    size: 1340,
    values: [100, 45, 33]
  }, {
    label: "Aug 4 – Aug 10",
    size: 1512,
    values: [100, 41]
  }, {
    label: "Aug 11 – Aug 17",
    size: 1604,
    values: [100]
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/charts-data.js", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/data.js
try { (() => {
const properties = [{
  id: "io",
  domain: "falorb.io",
  label: "Marketing site",
  visitors: "48,210",
  sessions: "61,884",
  delta: 8.7,
  bounce: "38.1%",
  series: [12, 15, 13, 18, 22, 20, 26, 24, 29, 27, 33, 36]
}, {
  id: "docs",
  domain: "docs.falorb.io",
  label: "Documentation",
  visitors: "19,447",
  sessions: "28,013",
  delta: 14.2,
  bounce: "24.6%",
  series: [6, 7, 9, 8, 11, 13, 12, 16, 15, 19, 18, 22]
}, {
  id: "app",
  domain: "app.falorb.io",
  label: "Dashboard",
  visitors: "6,092",
  sessions: "41,772",
  delta: -2.4,
  bounce: "9.8%",
  series: [20, 19, 21, 18, 17, 19, 16, 18, 15, 16, 14, 15]
}, {
  id: "blog",
  domain: "blog.falorb.io",
  label: "Changelog & writing",
  visitors: "12,865",
  sessions: "14,309",
  delta: 31.6,
  bounce: "61.4%",
  series: [3, 4, 4, 6, 5, 8, 7, 11, 14, 12, 18, 24]
}, {
  id: "status",
  domain: "status.falorb.io",
  label: "Status page",
  visitors: "2,118",
  sessions: "3,004",
  delta: -11.2,
  bounce: "72.0%",
  series: [9, 8, 7, 8, 6, 7, 5, 6, 5, 4, 4, 3]
}, {
  id: "hire",
  domain: "hire.falorb.io",
  label: "Jobs",
  visitors: "1,004",
  sessions: "1,190",
  delta: 4.1,
  bounce: "55.3%",
  series: [2, 2, 3, 2, 4, 3, 4, 5, 4, 6, 5, 6]
}];
const months = [{
  label: "Sep",
  value: 26
}, {
  label: "Oct",
  value: 31
}, {
  label: "Nov",
  value: 29
}, {
  label: "Dec",
  value: 22
}, {
  label: "Jan",
  value: 34
}, {
  label: "Feb",
  value: 38
}, {
  label: "Mar",
  value: 36
}, {
  label: "Apr",
  value: 44
}, {
  label: "May",
  value: 41
}, {
  label: "Jun",
  value: 49
}, {
  label: "Jul",
  value: 46
}, {
  label: "Aug",
  value: 54
}];
const pages = [{
  label: "/pricing",
  value: "8,412",
  share: 100,
  meta: "13.6%"
}, {
  label: "/docs/self-hosting",
  value: "6,209",
  share: 74,
  meta: "10.0%"
}, {
  label: "/",
  value: "5,884",
  share: 70,
  meta: "9.5%"
}, {
  label: "/docs/tracker",
  value: "3,110",
  share: 37,
  meta: "5.0%"
}, {
  label: "/blog/1kb-analytics",
  value: "2,447",
  share: 29,
  meta: "4.0%"
}, {
  label: "/changelog",
  value: "1,902",
  share: 22,
  meta: "3.1%"
}];
const referrers = [{
  label: "Direct / none",
  value: "22,914",
  share: 100,
  meta: "37.0%"
}, {
  label: "news.ycombinator.com",
  value: "9,338",
  share: 41,
  meta: "15.1%"
}, {
  label: "google.com",
  value: "7,102",
  share: 31,
  meta: "11.5%"
}, {
  label: "github.com",
  value: "4,880",
  share: 21,
  meta: "7.9%"
}, {
  label: "lobste.rs",
  value: "1,204",
  share: 5,
  meta: "1.9%"
}];
const countries = [{
  label: "Germany",
  value: "11,204",
  share: 100,
  meta: "18.1%"
}, {
  label: "United States",
  value: "10,882",
  share: 97,
  meta: "17.6%"
}, {
  label: "Netherlands",
  value: "6,441",
  share: 57,
  meta: "10.4%"
}, {
  label: "United Kingdom",
  value: "4,930",
  share: 44,
  meta: "8.0%"
}, {
  label: "Poland",
  value: "3,118",
  share: 28,
  meta: "5.0%"
}];
const people = [{
  id: "p1",
  handle: "maya@northvolt.dev",
  ident: true,
  props: ["falorb.io", "docs", "app"],
  sessions: 34,
  events: 412,
  first: "Mar 2, 2026",
  last: "2m ago",
  country: "DE",
  device: "macOS · Firefox"
}, {
  id: "p2",
  handle: "anon · 8f21c4d0",
  ident: false,
  props: ["falorb.io", "docs"],
  sessions: 11,
  events: 96,
  first: "Jul 19, 2026",
  last: "18m ago",
  country: "US",
  device: "Windows · Chrome"
}, {
  id: "p3",
  handle: "t.okafor@kestrel.io",
  ident: true,
  props: ["docs", "app", "status"],
  sessions: 27,
  events: 388,
  first: "Jan 8, 2026",
  last: "41m ago",
  country: "NL",
  device: "Linux · Chrome"
}, {
  id: "p4",
  handle: "anon · 3ba99017",
  ident: false,
  props: ["blog"],
  sessions: 2,
  events: 7,
  first: "Aug 14, 2026",
  last: "1h ago",
  country: "GB",
  device: "iOS · Safari"
}, {
  id: "p5",
  handle: "dev@lumenshift.co",
  ident: true,
  props: ["falorb.io", "app"],
  sessions: 19,
  events: 244,
  first: "Apr 30, 2026",
  last: "3h ago",
  country: "PL",
  device: "macOS · Safari"
}, {
  id: "p6",
  handle: "anon · c1770ab2",
  ident: false,
  props: ["falorb.io"],
  sessions: 1,
  events: 3,
  first: "Aug 16, 2026",
  last: "4h ago",
  country: "FR",
  device: "Android · Chrome"
}, {
  id: "p7",
  handle: "ops@harbourline.eu",
  ident: true,
  props: ["status", "app"],
  sessions: 63,
  events: 901,
  first: "Nov 11, 2025",
  last: "6h ago",
  country: "DE",
  device: "macOS · Chrome"
}, {
  id: "p8",
  handle: "anon · 55e0f83b",
  ident: false,
  props: ["docs"],
  sessions: 4,
  events: 22,
  first: "Aug 9, 2026",
  last: "9h ago",
  country: "US",
  device: "Windows · Edge"
}];
const timeline = [{
  time: "2m ago",
  prop: "app.falorb.io",
  event: "pageview",
  detail: "/people/8f21c4d0",
  dur: "1m 12s"
}, {
  time: "6m ago",
  prop: "app.falorb.io",
  event: "query.run",
  detail: "range=30d, filter=country:DE",
  dur: "—"
}, {
  time: "14m ago",
  prop: "docs.falorb.io",
  event: "pageview",
  detail: "/docs/self-hosting#postgres",
  dur: "4m 38s"
}, {
  time: "22m ago",
  prop: "docs.falorb.io",
  event: "copy.snippet",
  detail: "docker-compose.yml",
  dur: "—"
}, {
  time: "1h ago",
  prop: "falorb.io",
  event: "pageview",
  detail: "/pricing",
  dur: "2m 04s"
}, {
  time: "1h ago",
  prop: "falorb.io",
  event: "cta.click",
  detail: "Start self-hosting",
  dur: "—"
}, {
  time: "Yesterday",
  prop: "falorb.io",
  event: "pageview",
  detail: "/blog/1kb-analytics",
  dur: "6m 51s"
}];
Object.assign(window, {
  FALORB: {
    properties,
    months,
    pages,
    referrers,
    countries,
    people,
    timeline
  }
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/data.js", error: String((e && e.message) || e) }); }

// ui_kits/site/SiteHero.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  Button,
  Badge,
  Tag,
  Icon,
  StatTile,
  Sparkline,
  MetricBar,
  GlassPanel,
  SegmentedControl,
  DataTable,
  Card
} = window.FalorbDesignSystem_c510a5;
function SiteNav() {
  const links = ["Product", "Docs", "Pricing", "Changelog", "GitHub"];
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      gap: 26,
      height: 58,
      padding: "0 32px",
      background: "rgba(8,9,10,.72)",
      backdropFilter: "var(--glass-blur)",
      WebkitBackdropFilter: "var(--glass-blur)",
      borderBottom: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 22,
      height: 22,
      borderRadius: 6,
      background: "var(--ink-50)",
      color: "var(--ink-1000)",
      fontWeight: 600,
      fontSize: 13,
      letterSpacing: "-.04em"
    }
  }, "F"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: "-.03em",
      color: "var(--text-primary)"
    }
  }, "Falorb")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 20,
      marginLeft: 12
    }
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontSize: 13,
      color: "var(--text-secondary)"
    }
  }, l))), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost"
  }, "Sign in"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "primary"
  }, "Self-host free")));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: "relative",
      padding: "84px 32px 0",
      maxWidth: 1180,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      justifyItems: "center",
      gap: 18,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral",
    dot: true
  }, "v2.4 \xB7 Postgres 16 support"), /*#__PURE__*/React.createElement("h1", {
    style: {
      maxWidth: 860,
      fontSize: 62,
      lineHeight: 1.02,
      letterSpacing: "-.035em",
      fontWeight: 600,
      color: "var(--ink-0)"
    }
  }, "Every property on one page. Every person in one history."), /*#__PURE__*/React.createElement("p", {
    style: {
      maxWidth: 560,
      fontSize: 16,
      lineHeight: 1.55,
      color: "var(--text-secondary)"
    }
  }, "Falorb is first-party analytics you host yourself. A 1.94 KB tracker, no cookies, and person-level detail across your whole portfolio \u2014 built for small-to-medium traffic, not for ad networks."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "primary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "terminal",
      size: 15
    })
  }, "Start self-hosting"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "glass",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 15
    })
  }, "Read the docs")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      marginTop: 4,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "MIT licensed"), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, "docker compose up"), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, "no vendor account"))), /*#__PURE__*/React.createElement(ProductShot, null));
}
function ProductShot() {
  const months = [22, 31, 27, 38, 44, 36, 49, 41, 54, 47, 58, 62];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      marginTop: 54
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: "-40px -10px 40px",
      background: "radial-gradient(60% 60% at 50% 0%, rgba(125,211,252,.10), transparent 70%)",
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      padding: 12,
      background: "var(--surface-panel)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-shell)",
      boxShadow: "var(--shadow-4)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "2px 6px 12px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 5
    }
  }, ["var(--ink-600)", "var(--ink-600)", "var(--ink-600)"].map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 8,
      height: 8,
      borderRadius: 999,
      background: c
    }
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, "analytics.yourcompany.dev"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    size: "sm",
    options: ["24h", "7d", "30d", "12m"],
    value: "12m",
    onChange: () => {}
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 10,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Unique visitors",
    value: "89,736",
    delta: 9.4,
    series: [12, 15, 14, 19, 22, 21, 27, 26, 31, 34]
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Sessions",
    value: "150,172",
    delta: 6.1
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Median session",
    value: "1m 48s",
    delta: 2.2
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Tracker payload",
    value: "1.94",
    unit: "KB",
    footnote: "gzipped \xB7 no cookies"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.6fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      padding: 16,
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 6,
      height: 150
    }
  }, months.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: `${v / 62 * 100}%`,
      borderRadius: "var(--radius-2)",
      background: i === 8 ? "var(--glacier-400)" : "var(--w-4)",
      backgroundImage: i === 8 ? undefined : "var(--hatch)",
      borderTop: i === 8 ? "none" : "1.5px solid var(--series-1)"
    }
  }))), /*#__PURE__*/React.createElement(GlassPanel, {
    padding: 12,
    radius: "var(--radius-card)",
    style: {
      position: "absolute",
      top: 30,
      left: "48%",
      minWidth: 184
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--text-muted)",
      marginBottom: 7
    }
  }, "May 2026"), [["Visitors", "33,801", "var(--series-1)"], ["Sessions", "41,209", "var(--series-2)"]].map(([l, v, c]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: "flex",
      justifyContent: "space-between",
      gap: 18,
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: c
    }
  }), l), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--text-primary)"
    }
  }, v))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 1,
      padding: 6,
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)",
      alignContent: "start"
    }
  }, window.FALORB_SITE.pages.map(p => /*#__PURE__*/React.createElement(MetricBar, _extends({
    key: p.label
  }, p, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "file",
      size: 13
    })
  })))))));
}
Object.assign(window, {
  SiteNav,
  Hero,
  ProductShot
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/site/SiteHero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/site/SiteSections.jsx
try { (() => {
const {
  Button,
  Badge,
  Icon,
  Card,
  Tag,
  DataTable,
  Sparkline,
  StatTile
} = window.FalorbDesignSystem_c510a5;
const FEATURES = [{
  icon: "layout-grid",
  title: "One page, every property",
  body: "Portfolio view first. Visitors, sessions and trend for all six sites before you click anything."
}, {
  icon: "user-search",
  title: "Person-level history",
  body: "Open a single human and read their whole path across your properties, in order, with durations."
}, {
  icon: "feather",
  title: "1.94 KB tracker",
  body: "One request, no cookies, no third-party domain. Passes the same-origin sniff test in every audit."
}, {
  icon: "server",
  title: "Runs on your box",
  body: "Postgres and a single binary. docker compose up, then point a subdomain at it."
}, {
  icon: "gauge",
  title: "Fast on modest hardware",
  body: "p95 query under 200ms at 8.4M retained events on two vCPUs. Sampling only above 1M/day."
}, {
  icon: "lock",
  title: "Your data stays yours",
  body: "No account, no egress, no shared warehouse. Delete a person and the rows are actually gone."
}];
function FeatureGrid() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: "104px 32px 0",
      maxWidth: 1180,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 10,
      maxWidth: 620,
      marginBottom: 34
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, "Why Falorb"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 34,
      letterSpacing: "-.028em",
      lineHeight: 1.1,
      fontWeight: 600,
      color: "var(--ink-0)"
    }
  }, "Built for the traffic you actually have"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 15,
      lineHeight: 1.6,
      color: "var(--text-secondary)"
    }
  }, "Warehouse-scale analytics makes you pay in complexity for volume you will never see. Falorb assumes thousands of visitors, not millions, and spends the budget on detail instead.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 12
    }
  }, FEATURES.map(f => /*#__PURE__*/React.createElement("div", {
    key: f.title,
    style: {
      display: "grid",
      gap: 9,
      padding: 18,
      background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-card)",
      boxShadow: "var(--edge-top)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 30,
      height: 30,
      borderRadius: "var(--radius-3)",
      background: "var(--w-4)",
      border: "1px solid var(--border-subtle)",
      color: "var(--glacier-300)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: f.icon,
    size: 15
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: "var(--text-primary)"
    }
  }, f.title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      lineHeight: 1.55,
      color: "var(--text-secondary)"
    }
  }, f.body)))));
}
function InstallBlock() {
  const [copied, setCopied] = React.useState(false);
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: "104px 32px 0",
      maxWidth: 1180,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 40,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, "Install"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 34,
      letterSpacing: "-.028em",
      lineHeight: 1.1,
      fontWeight: 600,
      color: "var(--ink-0)"
    }
  }, "Two commands and one script tag"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 15,
      lineHeight: 1.6,
      color: "var(--text-secondary)"
    }
  }, "No agent, no queue to operate, no separate ingest service. The binary serves the dashboard, the tracker and the API on one port."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 14
    })
  }, "Self-hosting guide"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "github",
      size: 14
    })
  }, "Source"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "12px 14px",
      background: "var(--surface-inset)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-3)",
      fontFamily: "var(--font-mono)",
      fontSize: 12.5,
      color: "var(--glacier-200)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)"
    }
  }, "$"), "docker compose up -d falorb"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 14px",
      background: "var(--surface-inset)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-3)",
      fontFamily: "var(--font-mono)",
      fontSize: 12.5,
      lineHeight: 1.6,
      color: "var(--glacier-200)",
      whiteSpace: "pre"
    }
  }, `<script defer src="https://analytics.you.dev/f.js"
  data-property="you.dev"></script>`), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: copied ? "check" : "clipboard",
      size: 13
    }),
    onClick: () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }, copied ? "Copied" : "Copy snippet")))));
}
const PLANS = [{
  name: "Self-hosted",
  price: "Free",
  meta: "MIT licensed",
  body: "Unlimited properties and events on your own hardware.",
  cta: "Get the binary",
  variant: "secondary",
  rows: ["Every feature", "Community support", "No telemetry"]
}, {
  name: "Supported",
  price: "$39",
  meta: "per month, per instance",
  body: "The same binary, plus upgrade help and a private issue queue.",
  cta: "Start supported",
  variant: "primary",
  featured: true,
  rows: ["Priority patches", "Migration review", "48h response"]
}, {
  name: "Managed",
  price: "$140",
  meta: "per month",
  body: "We run the instance in your region and hand you the keys.",
  cta: "Talk to us",
  variant: "secondary",
  rows: ["Your region", "Daily snapshots", "99.9% target"]
}];
function Pricing() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: "104px 32px 0",
      maxWidth: 1180,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 10,
      maxWidth: 560,
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, "Pricing"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 34,
      letterSpacing: "-.028em",
      lineHeight: 1.1,
      fontWeight: 600,
      color: "var(--ink-0)"
    }
  }, "Pay for help, not for events")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 12
    }
  }, PLANS.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      display: "grid",
      gap: 14,
      padding: 20,
      background: p.featured ? "var(--surface-raised)" : "var(--surface-card)",
      border: "1px solid " + (p.featured ? "rgba(125,211,252,.24)" : "var(--border-subtle)"),
      borderRadius: "var(--radius-card)",
      boxShadow: p.featured ? "var(--shadow-3)" : "var(--edge-top)",
      alignContent: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: "var(--text-primary)"
    }
  }, p.name), p.featured && /*#__PURE__*/React.createElement(Badge, {
    tone: "accent"
  }, "most picked")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontFeatureSettings: "var(--tnum)",
      fontSize: 34,
      letterSpacing: "-.03em",
      color: "var(--ink-0)"
    }
  }, p.price), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-muted)"
    }
  }, p.meta)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      lineHeight: 1.55,
      color: "var(--text-secondary)"
    }
  }, p.body), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 7,
      paddingTop: 4,
      borderTop: "1px solid var(--grid-line)"
    }
  }, p.rows.map(r => /*#__PURE__*/React.createElement("span", {
    key: r,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12.5,
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13,
    color: "var(--glacier-400)"
  }), r))), /*#__PURE__*/React.createElement(Button, {
    variant: p.variant,
    fullWidth: true
  }, p.cta)))));
}
function SiteFooter() {
  const cols = [{
    h: "Product",
    items: ["Overview", "Person profiles", "Self-hosting", "Changelog"]
  }, {
    h: "Docs",
    items: ["Install", "Tracker API", "Query API", "Migrating in"]
  }, {
    h: "Project",
    items: ["GitHub", "Roadmap", "License", "Security"]
  }];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      marginTop: 104,
      padding: "34px 32px 40px",
      borderTop: "1px solid var(--border-subtle)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.4fr repeat(3,1fr)",
      gap: 28,
      maxWidth: 1180,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 10,
      alignContent: "start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 22,
      height: 22,
      borderRadius: 6,
      background: "var(--ink-50)",
      color: "var(--ink-1000)",
      fontWeight: 600,
      fontSize: 13,
      letterSpacing: "-.04em"
    }
  }, "F"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: "-.03em",
      color: "var(--text-primary)"
    }
  }, "Falorb")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-muted)",
      maxWidth: 260,
      lineHeight: 1.55
    }
  }, "Self-hosted, first-party analytics. Built in Berlin, licensed MIT.")), cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.h,
    style: {
      display: "grid",
      gap: 8,
      alignContent: "start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "var(--ls-label)",
      color: "var(--text-muted)",
      fontWeight: 500
    }
  }, c.h), c.items.map(i => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: "#",
    style: {
      fontSize: 13,
      color: "var(--text-secondary)"
    }
  }, i))))));
}
Object.assign(window, {
  FeatureGrid,
  InstallBlock,
  Pricing,
  SiteFooter
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/site/SiteSections.jsx", error: String((e && e.message) || e) }); }

__ds_ns.ChartFrame = __ds_scope.ChartFrame;

__ds_ns.DonutChart = __ds_scope.DonutChart;

__ds_ns.FunnelChart = __ds_scope.FunnelChart;

__ds_ns.HeatmapGrid = __ds_scope.HeatmapGrid;

__ds_ns.Legend = __ds_scope.Legend;

__ds_ns.LineChart = __ds_scope.LineChart;

__ds_ns.RetentionMatrix = __ds_scope.RetentionMatrix;

__ds_ns.SankeyDiagram = __ds_scope.SankeyDiagram;

__ds_ns.StackedBars = __ds_scope.StackedBars;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.GlassPanel = __ds_scope.GlassPanel;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.BarSeries = __ds_scope.BarSeries;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.DeltaPill = __ds_scope.DeltaPill;

__ds_ns.MetricBar = __ds_scope.MetricBar;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.SidebarNav = __ds_scope.SidebarNav;

__ds_ns.Tabs = __ds_scope.Tabs;

})();

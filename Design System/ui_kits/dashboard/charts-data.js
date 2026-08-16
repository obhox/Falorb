window.FALORB_CHARTS = {
  months: ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
  visitors: [26, 31, 29, 22, 34, 38, 36, 44, 41, 49, 46, 54],
  sessions: [38, 44, 41, 33, 48, 53, 50, 61, 57, 66, 63, 72],
  sourceStack: [
    { label: "Sep", values: [12, 9, 5] }, { label: "Oct", values: [14, 11, 6] },
    { label: "Nov", values: [13, 10, 6] }, { label: "Dec", values: [10, 8, 4] },
    { label: "Jan", values: [16, 12, 6] }, { label: "Feb", values: [18, 13, 7] },
    { label: "Mar", values: [17, 13, 6] }, { label: "Apr", values: [21, 15, 8] },
    { label: "May", values: [19, 14, 8] }, { label: "Jun", values: [23, 17, 9] },
    { label: "Jul", values: [21, 16, 9] }, { label: "Aug", values: [25, 19, 10] }
  ],
  sourceSeries: [
    { name: "Direct", color: "var(--series-1)" },
    { name: "Search", color: "var(--series-2)" },
    { name: "Social", color: "var(--series-4)" }
  ],
  devices: [
    { label: "Desktop", value: 61 },
    { label: "Mobile", value: 31 },
    { label: "Tablet", value: 8 }
  ],
  browsers: [
    { label: "Chrome", value: 44 }, { label: "Firefox", value: 27 },
    { label: "Safari", value: 21 }, { label: "Edge", value: 8 }
  ],
  funnel: [
    { label: "Viewed pricing", value: 8412 },
    { label: "Opened docs", value: 3110 },
    { label: "Copied snippet", value: 1204 },
    { label: "First event received", value: 702 }
  ],
  sankeyNodes: [
    { id: "search", label: "Search", column: 0 },
    { id: "hn", label: "Hacker News", column: 0 },
    { id: "direct", label: "Direct", column: 0 },
    { id: "marketing", label: "falorb.io", column: 1 },
    { id: "docs", label: "docs.falorb.io", column: 1 },
    { id: "snippet", label: "Copied snippet", column: 2 },
    { id: "signup", label: "Created instance", column: 2 },
    { id: "exit", label: "Left", column: 2 }
  ],
  sankeyLinks: [
    { from: "search", to: "docs", value: 6209 },
    { from: "search", to: "marketing", value: 2100 },
    { from: "hn", to: "marketing", value: 5338 },
    { from: "hn", to: "docs", value: 1200 },
    { from: "direct", to: "marketing", value: 3800 },
    { from: "marketing", to: "snippet", value: 2400 },
    { from: "marketing", to: "signup", value: 940 },
    { from: "marketing", to: "exit", value: 7898 },
    { from: "docs", to: "snippet", value: 4100 },
    { from: "docs", to: "signup", value: 1180 },
    { from: "docs", to: "exit", value: 2129 }
  ],
  hours: ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"],
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  heat: [
    [4, 3, 2, 6, 22, 41, 52, 58, 49, 33, 18, 9],
    [5, 3, 2, 7, 24, 44, 55, 61, 51, 35, 19, 10],
    [4, 2, 2, 6, 26, 46, 57, 62, 53, 36, 20, 11],
    [5, 3, 3, 8, 25, 43, 54, 59, 50, 34, 21, 12],
    [6, 4, 3, 7, 21, 38, 47, 44, 36, 27, 22, 15],
    [8, 6, 4, 5, 11, 17, 21, 24, 22, 20, 17, 12],
    [7, 5, 3, 4, 9, 14, 19, 22, 20, 18, 14, 10]
  ],
  cohorts: [
    { label: "Jul 7 – Jul 13", size: 1180, values: [100, 39, 28, 22, 19, 17] },
    { label: "Jul 14 – Jul 20", size: 1284, values: [100, 42, 31, 24, 21] },
    { label: "Jul 21 – Jul 27", size: 1102, values: [100, 38, 29, 22] },
    { label: "Jul 28 – Aug 3", size: 1340, values: [100, 45, 33] },
    { label: "Aug 4 – Aug 10", size: 1512, values: [100, 41] },
    { label: "Aug 11 – Aug 17", size: 1604, values: [100] }
  ]
};

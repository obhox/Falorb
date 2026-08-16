const properties = [
  { id: "io", domain: "falorb.io", label: "Marketing site", visitors: "48,210", sessions: "61,884", delta: 8.7, bounce: "38.1%", series: [12, 15, 13, 18, 22, 20, 26, 24, 29, 27, 33, 36] },
  { id: "docs", domain: "docs.falorb.io", label: "Documentation", visitors: "19,447", sessions: "28,013", delta: 14.2, bounce: "24.6%", series: [6, 7, 9, 8, 11, 13, 12, 16, 15, 19, 18, 22] },
  { id: "app", domain: "app.falorb.io", label: "Dashboard", visitors: "6,092", sessions: "41,772", delta: -2.4, bounce: "9.8%", series: [20, 19, 21, 18, 17, 19, 16, 18, 15, 16, 14, 15] },
  { id: "blog", domain: "blog.falorb.io", label: "Changelog & writing", visitors: "12,865", sessions: "14,309", delta: 31.6, bounce: "61.4%", series: [3, 4, 4, 6, 5, 8, 7, 11, 14, 12, 18, 24] },
  { id: "status", domain: "status.falorb.io", label: "Status page", visitors: "2,118", sessions: "3,004", delta: -11.2, bounce: "72.0%", series: [9, 8, 7, 8, 6, 7, 5, 6, 5, 4, 4, 3] },
  { id: "hire", domain: "hire.falorb.io", label: "Jobs", visitors: "1,004", sessions: "1,190", delta: 4.1, bounce: "55.3%", series: [2, 2, 3, 2, 4, 3, 4, 5, 4, 6, 5, 6] }
];

const months = [
  { label: "Sep", value: 26 }, { label: "Oct", value: 31 }, { label: "Nov", value: 29 },
  { label: "Dec", value: 22 }, { label: "Jan", value: 34 }, { label: "Feb", value: 38 },
  { label: "Mar", value: 36 }, { label: "Apr", value: 44 }, { label: "May", value: 41 },
  { label: "Jun", value: 49 }, { label: "Jul", value: 46 }, { label: "Aug", value: 54 }
];

const pages = [
  { label: "/pricing", value: "8,412", share: 100, meta: "13.6%" },
  { label: "/docs/self-hosting", value: "6,209", share: 74, meta: "10.0%" },
  { label: "/", value: "5,884", share: 70, meta: "9.5%" },
  { label: "/docs/tracker", value: "3,110", share: 37, meta: "5.0%" },
  { label: "/blog/1kb-analytics", value: "2,447", share: 29, meta: "4.0%" },
  { label: "/changelog", value: "1,902", share: 22, meta: "3.1%" }
];

const referrers = [
  { label: "Direct / none", value: "22,914", share: 100, meta: "37.0%" },
  { label: "news.ycombinator.com", value: "9,338", share: 41, meta: "15.1%" },
  { label: "google.com", value: "7,102", share: 31, meta: "11.5%" },
  { label: "github.com", value: "4,880", share: 21, meta: "7.9%" },
  { label: "lobste.rs", value: "1,204", share: 5, meta: "1.9%" }
];

const countries = [
  { label: "Germany", value: "11,204", share: 100, meta: "18.1%" },
  { label: "United States", value: "10,882", share: 97, meta: "17.6%" },
  { label: "Netherlands", value: "6,441", share: 57, meta: "10.4%" },
  { label: "United Kingdom", value: "4,930", share: 44, meta: "8.0%" },
  { label: "Poland", value: "3,118", share: 28, meta: "5.0%" }
];

const people = [
  { id: "p1", handle: "maya@northvolt.dev", ident: true, props: ["falorb.io", "docs", "app"], sessions: 34, events: 412, first: "Mar 2, 2026", last: "2m ago", country: "DE", device: "macOS · Firefox" },
  { id: "p2", handle: "anon · 8f21c4d0", ident: false, props: ["falorb.io", "docs"], sessions: 11, events: 96, first: "Jul 19, 2026", last: "18m ago", country: "US", device: "Windows · Chrome" },
  { id: "p3", handle: "t.okafor@kestrel.io", ident: true, props: ["docs", "app", "status"], sessions: 27, events: 388, first: "Jan 8, 2026", last: "41m ago", country: "NL", device: "Linux · Chrome" },
  { id: "p4", handle: "anon · 3ba99017", ident: false, props: ["blog"], sessions: 2, events: 7, first: "Aug 14, 2026", last: "1h ago", country: "GB", device: "iOS · Safari" },
  { id: "p5", handle: "dev@lumenshift.co", ident: true, props: ["falorb.io", "app"], sessions: 19, events: 244, first: "Apr 30, 2026", last: "3h ago", country: "PL", device: "macOS · Safari" },
  { id: "p6", handle: "anon · c1770ab2", ident: false, props: ["falorb.io"], sessions: 1, events: 3, first: "Aug 16, 2026", last: "4h ago", country: "FR", device: "Android · Chrome" },
  { id: "p7", handle: "ops@harbourline.eu", ident: true, props: ["status", "app"], sessions: 63, events: 901, first: "Nov 11, 2025", last: "6h ago", country: "DE", device: "macOS · Chrome" },
  { id: "p8", handle: "anon · 55e0f83b", ident: false, props: ["docs"], sessions: 4, events: 22, first: "Aug 9, 2026", last: "9h ago", country: "US", device: "Windows · Edge" }
];

const timeline = [
  { time: "2m ago", prop: "app.falorb.io", event: "pageview", detail: "/people/8f21c4d0", dur: "1m 12s" },
  { time: "6m ago", prop: "app.falorb.io", event: "query.run", detail: "range=30d, filter=country:DE", dur: "—" },
  { time: "14m ago", prop: "docs.falorb.io", event: "pageview", detail: "/docs/self-hosting#postgres", dur: "4m 38s" },
  { time: "22m ago", prop: "docs.falorb.io", event: "copy.snippet", detail: "docker-compose.yml", dur: "—" },
  { time: "1h ago", prop: "falorb.io", event: "pageview", detail: "/pricing", dur: "2m 04s" },
  { time: "1h ago", prop: "falorb.io", event: "cta.click", detail: "Start self-hosting", dur: "—" },
  { time: "Yesterday", prop: "falorb.io", event: "pageview", detail: "/blog/1kb-analytics", dur: "6m 51s" }
];

Object.assign(window, { FALORB: { properties, months, pages, referrers, countries, people, timeline } });

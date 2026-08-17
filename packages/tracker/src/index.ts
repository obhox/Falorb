/**
 * Falorb browser tracker.
 *
 * Constraints that shape every decision here:
 *  - Must never break the host page. Everything runs inside try/catch and any
 *    failure degrades to "no analytics", never to a broken site.
 *  - Must stay tiny. No dependencies, no classes, no polyfills; features are
 *    feature-detected and silently skipped on browsers that lack them.
 *  - Must not lose the last event. Real drop-off data lives in the moment
 *    someone leaves, so the exit path is beaconed on visibilitychange rather
 *    than unload (which Safari and mobile Chrome routinely skip).
 */

// Marks this file as a module so the `declare global` block below is legal.
// esbuild strips it when bundling to IIFE, so it costs nothing at runtime.
export {};

type Props = Record<string, string | number | boolean | null>;

interface WireEvent {
  n: string;
  t: number;
  u?: string;
  r?: string;
  ti?: string;
  p?: Props;
  du?: number;
  rv?: number;
  cu?: string;
}

interface QueuedCall {
  0: string;
  [i: number]: unknown;
}

declare global {
  interface Window {
    falorb?: FalorbApi & { q?: IArguments[] | QueuedCall[] };
  }
}

interface FalorbApi {
  (method: string, ...args: unknown[]): void;
  track: (name: string, props?: Props) => void;
  page: (url?: string) => void;
  identify: (userId: string, traits?: Props) => void;
  group: (groupId: string, traits?: Props) => void;
  revenue: (amount: number, currency?: string, props?: Props) => void;
  reset: () => void;
  consent: (granted: boolean) => void;
}

const VERSION = "1";

(function () {
  const w = window;
  const d = document;
  const nav = navigator;

  // --- configuration -------------------------------------------------------

  const script =
    (d.currentScript as HTMLScriptElement | null) ??
    (d.querySelector("script[data-project]") as HTMLScriptElement | null);
  if (!script) return;

  const cfg = script.dataset;
  const projectKey = cfg.project;
  if (!projectKey) return;

  // Default the collector origin to wherever this script was served from, so
  // the common case needs only data-project.
  let host = cfg.host ?? "";
  if (!host) {
    try {
      host = new URL(script.src).origin;
    } catch {
      return;
    }
  }

  const autoCapture = cfg.auto !== "0";
  const cookieless = cfg.cookieless === "1";
  const requireConsent = cfg.consent === "opt-in";
  const crossDomains = (cfg.crossDomain ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Respect Do Not Track / Global Privacy Control unless explicitly overridden.
  if (cfg.respectDnt !== "0") {
    const dnt =
      (nav as unknown as { doNotTrack?: string }).doNotTrack ??
      (w as unknown as { doNotTrack?: string }).doNotTrack;
    const gpc = (nav as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl;
    if (dnt === "1" || dnt === "yes" || gpc === true) return;
  }

  // --- state ---------------------------------------------------------------

  const SESSION_TIMEOUT = 30 * 60 * 1000;
  const DEVICE_KEY = "_falorb_did";
  const SESSION_KEY = "_falorb_sid";
  const USER_KEY = "_falorb_uid";
  const CONSENT_KEY = "_falorb_consent";

  let queue: WireEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let consentGranted = !requireConsent || store(CONSENT_KEY) === "1";

  let lastPath = "";
  let pageEnteredAt = now();
  let maxScroll = 0;
  // A page can only be left once. Closing a tab fires visibilitychange->hidden
  // *and* pagehide, and both report the exit, so without this every session
  // recorded two identical $pageleave events at the same instant.
  let leaveSent = false;

  function now(): number {
    return Date.now();
  }

  /**
   * Random identifier.
   *
   * `crypto.randomUUID` where available, otherwise time plus randomness. The
   * intermediate `getRandomValues` branch was removed to buy back bytes: it
   * only served browsers with `crypto` but without `randomUUID` — Safari below
   * 15.4 and Chrome below 92 — and the fallback below still produces a
   * perfectly serviceable id for them. These are device identifiers for
   * analytics, not secrets, so the weaker entropy of the fallback costs
   * nothing that matters.
   */
  function uid(): string {
    const c = w.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return String(now()) + Math.random().toString(16).slice(2);
  }

  /**
   * Storage accessor for both local and session storage. Safari private mode
   * throws on write and some hardened browsers throw on read, so every access
   * is guarded and degrades to null rather than propagating.
   */
  function io(s: Storage, key: string, value?: string): string | null {
    try {
      if (value === undefined) return s.getItem(key);
      s.setItem(key, value);
      return value;
    } catch {
      return null;
    }
  }

  function store(key: string, value?: string): string | null {
    return io(localStorage, key, value);
  }

  function session(key: string, value?: string): string | null {
    return io(sessionStorage, key, value);
  }

  /**
   * Device identity.
   *
   * In cookieless mode nothing is persisted at all: the id lives only for the
   * lifetime of the tab, and the server derives a daily-rotating salted hash
   * instead. That is the configuration that avoids a consent banner in most EU
   * jurisdictions, at the cost of not recognising a returning visitor.
   */
  function deviceId(): string {
    if (cookieless) {
      let id = session(DEVICE_KEY);
      if (!id) id = session(DEVICE_KEY, uid()) ?? uid();
      return id;
    }
    let id = store(DEVICE_KEY);
    if (!id) id = store(DEVICE_KEY, uid()) ?? uid();
    return id;
  }

  function sessionId(): string {
    const raw = session(SESSION_KEY);
    const ts = now();
    if (raw) {
      const sep = raw.lastIndexOf(".");
      const last = +raw.slice(sep + 1);
      if (ts - last < SESSION_TIMEOUT) {
        const id = raw.slice(0, sep);
        session(SESSION_KEY, id + "." + ts);
        return id;
      }
    }
    const id = uid();
    session(SESSION_KEY, id + "." + ts);
    return id;
  }

  // --- transport -----------------------------------------------------------

  function flush(sync?: boolean): void {
    if (!queue.length || !consentGranted) return;
    const events = queue;
    queue = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }

    const body: Record<string, unknown> = {
      k: projectKey,
      d: deviceId(),
      s: sessionId(),
      v: VERSION,
      e: events,
    };

    const userId = store(USER_KEY);
    if (userId) body.i = userId;

    const s = w.screen;
    if (s) {
      body.sw = s.width;
      body.sh = s.height;
    }
    body.vw = w.innerWidth;
    body.vh = w.innerHeight;
    body.l = nav.language;
    try {
      body.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* older browsers */
    }

    const linkToken = crossDomainToken();
    if (linkToken) body.xl = linkToken;

    const payload = JSON.stringify(body);
    const url = host + "/e";

    // sendBeacon survives the page being torn down; fetch(keepalive) is the
    // fallback. A plain fetch would be cancelled mid-navigation and lose the
    // exit event, which is precisely the one that matters for drop-off.
    // `typeof` rather than truthiness: TypeScript's lib types declare these as
    // always present, but the runtime check still matters on older browsers.
    const hasBeacon = typeof nav.sendBeacon === "function";
    try {
      if (sync && hasBeacon && nav.sendBeacon(url, payload)) return;
      if (typeof w.fetch === "function") {
        void fetch(url, {
          method: "POST",
          body: payload,
          keepalive: true,
          mode: "cors",
          credentials: "omit",
          headers: { "Content-Type": "text/plain" },
        }).catch(() => {});
        return;
      }
      if (hasBeacon) nav.sendBeacon(url, payload);
    } catch {
      /* never surface a transport failure to the page */
    }
  }

  function enqueue(e: WireEvent): boolean {
    if (!consentGranted) return false;
    queue.push(e);
    if (queue.length >= 10) {
      flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => flush(), 2000);
    }
    return true;
  }

  function base(name: string, props?: Props): WireEvent {
    const e: WireEvent = { n: name, t: now(), u: location.href };
    if (d.referrer) e.r = d.referrer;
    if (props) e.p = props;
    return e;
  }

  // --- cross-domain identity ----------------------------------------------

  /**
   * Read the `_pl` token a sibling domain appended to the inbound link, so the
   * server can stitch this visit to the same person. Consumed once and stripped
   * from the visible URL.
   *
   * This is first-party linking between properties the same organisation owns —
   * the mechanism Google's cross-domain linker uses. It is not a third-party
   * cookie and does not follow anyone onto sites we do not control.
   */
  function crossDomainToken(): string | null {
    try {
      const params = new URLSearchParams(location.search);
      const token = params.get("_pl");
      if (!token) return null;
      params.delete("_pl");
      const qs = params.toString();
      history.replaceState(
        history.state,
        "",
        location.pathname + (qs ? "?" + qs : "") + location.hash,
      );
      return token;
    } catch {
      return null;
    }
  }

  function decorate(a: HTMLAnchorElement): void {
    if (!crossDomains.length) return;
    try {
      const url = new URL(a.href);
      const h = url.hostname.toLowerCase().replace(/^www\./, "");
      if (h === location.hostname.toLowerCase().replace(/^www\./, "")) return;
      if (crossDomains.indexOf(h) < 0) return;
      // Timestamped so the server can reject a stale token that was copied,
      // shared, or indexed.
      url.searchParams.set("_pl", btoa(deviceId() + "." + now()).replace(/=+$/, ""));
      a.href = url.toString();
    } catch {
      /* ignore malformed hrefs */
    }
  }

  // --- public API ----------------------------------------------------------

  function track(name: string, props?: Props): void {
    enqueue(base(name, props));
  }

  function page(url?: string): void {
    const path = url ?? location.pathname;
    if (path === lastPath) return;

    if (lastPath) sendPageLeave();

    const e = base("$pageview");
    e.ti = d.title;

    /**
     * Commit the new page only if its pageview was accepted.
     *
     * `enqueue` drops everything until consent is granted. This used to set
     * `lastPath` first, so a page loaded before consent recorded itself as
     * reported while nothing had been sent — and the retry in `consent()` then
     * hit the `path === lastPath` guard and returned immediately. The pageview
     * was lost for good, while every later event on the same page (pageleave,
     * web vitals) enqueued normally once consent arrived. A session with an
     * exit but no entry is exactly what that looks like.
     */
    if (!enqueue(e)) return;

    lastPath = path;
    pageEnteredAt = now();
    maxScroll = 0;
    leaveSent = false;
  }

  function sendPageLeave(): void {
    if (leaveSent) return;
    leaveSent = true;
    const e = base("$pageleave", { scroll_depth: maxScroll });
    e.du = now() - pageEnteredAt;
    enqueue(e);
  }

  function identify(userId: string, traits?: Props): void {
    if (!userId) return;
    store(USER_KEY, userId);
    const e = base("$identify");
    if (traits) e.p = traits;
    enqueue(e);
    // Identity changes are the trigger for a server-side person merge, so send
    // immediately rather than waiting out the batch window.
    flush();
  }

  function group(groupId: string, traits?: Props): void {
    const e = base("$group", { ...(traits ?? {}), group_id: groupId });
    enqueue(e);
  }

  function revenue(amount: number, currency?: string, props?: Props): void {
    const e = base("$revenue", props);
    e.rv = amount;
    e.cu = currency ?? "USD";
    enqueue(e);
    flush();
  }

  function reset(): void {
    try {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(DEVICE_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  function consent(granted: boolean): void {
    consentGranted = granted;
    store(CONSENT_KEY, granted ? "1" : "0");
    if (granted) {
      page();
      flush();
    } else {
      queue = [];
    }
  }

  // --- auto-capture --------------------------------------------------------

  function autoInit(): void {
    // SPA navigation. Patching history is the only way to observe pushState;
    // popstate alone misses programmatic route changes entirely.
    const push = history.pushState;
    const replace = history.replaceState;
    if (push) {
      history.pushState = function (...args) {
        push.apply(this, args as never);
        setTimeout(() => page(), 0);
      };
    }
    if (replace) {
      history.replaceState = function (...args) {
        replace.apply(this, args as never);
        setTimeout(() => page(), 0);
      };
    }
    w.addEventListener("popstate", () => page());

    // Clicks: outbound, downloads, tagged elements, and rage detection.
    let clickTimes: number[] = [];
    let lastX = 0;
    let lastY = 0;

    d.addEventListener(
      "click",
      (ev) => {
        try {
          const t = ev.target as Element | null;
          if (!t || !t.closest) return;

          // Rage click: three clicks inside 700ms within a 30px radius.
          const tNow = now();
          if (Math.abs(ev.clientX - lastX) < 30 && Math.abs(ev.clientY - lastY) < 30) {
            clickTimes.push(tNow);
            clickTimes = clickTimes.filter((x) => tNow - x < 700);
            if (clickTimes.length >= 3) {
              track("$rage_click", { selector: selectorOf(t), text: labelOf(t) });
              clickTimes = [];
            }
          } else {
            clickTimes = [tNow];
          }
          lastX = ev.clientX;
          lastY = ev.clientY;

          detectDeadClick(t);

          const a = t.closest("a") as HTMLAnchorElement | null;
          if (a && a.href) {
            decorate(a);
            const url = new URL(a.href, location.href);
            const external = url.hostname !== location.hostname;
            if (/\.(pdf|zip|dmg|exe|csv|xlsx?|docx?|pptx?|mp4|mp3)$/i.test(url.pathname)) {
              track("$download", { href: a.href, text: labelOf(a) });
            } else if (external) {
              track("$outbound_click", { href: a.href, host: url.hostname, text: labelOf(a) });
            }
          }

          const tagged = t.closest("[data-falorb]") as HTMLElement | null;
          if (tagged) {
            const name = tagged.dataset.falorb || "$click";
            const props: Props = { text: labelOf(tagged) };
            // `data-falorb-prop-plan` arrives in the dataset as `falorbPropPlan`.
            // The offset is derived from the prefix rather than hardcoded, so
            // renaming the brand cannot silently truncate every property name.
            const PROP_PREFIX = "falorbProp";
            for (const k in tagged.dataset) {
              if (k.indexOf(PROP_PREFIX) === 0) {
                props[k.slice(PROP_PREFIX.length).toLowerCase()] = tagged.dataset[k] ?? "";
              }
            }
            track(name, props);
          }
        } catch {
          /* never block a click */
        }
      },
      true,
    );

    // Form submissions. Only the form's identity is recorded — never field
    // values, which would sweep up passwords, emails and card numbers.
    d.addEventListener(
      "submit",
      (ev) => {
        try {
          const f = ev.target as HTMLFormElement;
          track("$form_submit", { id: f.id || "", name: f.name || "", action: f.action || "" });
        } catch {
          /* ignore */
        }
      },
      true,
    );

    // Scroll depth, sampled on a throttle so it costs nothing on long pages.
    let scrollTick = false;
    w.addEventListener(
      "scroll",
      () => {
        if (scrollTick) return;
        scrollTick = true;
        setTimeout(() => {
          scrollTick = false;
          try {
            const el = d.documentElement;
            const total = el.scrollHeight - el.clientHeight;
            if (total <= 0) return;
            const pct = Math.min(100, Math.round(((w.scrollY || 0) / total) * 100));
            if (pct > maxScroll) maxScroll = pct;
          } catch {
            /* ignore */
          }
        }, 300);
      },
      { passive: true },
    );

    w.addEventListener("error", (ev) => {
      track("$error", {
        message: String(ev.message).slice(0, 300),
        source: String(ev.filename ?? "").slice(0, 200),
        line: ev.lineno ?? 0,
      });
    });

    w.addEventListener("unhandledrejection", (ev) => {
      track("$error", { message: String(ev.reason).slice(0, 300), kind: "unhandled_rejection" });
    });

    vitals();
  }

  /**
   * Core Web Vitals, hand-rolled. The `web-vitals` package is ~5KB and this
   * needs a few hundred bytes: observe the entry types, keep the latest value,
   * and report once on the way out.
   */
  function vitals(): void {
    if (!w.PerformanceObserver) return;
    const v: Props = {};

    const observe = (type: string, cb: (e: PerformanceEntry) => void) => {
      try {
        const po = new PerformanceObserver((list) => list.getEntries().forEach(cb));
        po.observe({ type, buffered: true } as PerformanceObserverInit);
      } catch {
        /* unsupported entry type */
      }
    };

    observe("largest-contentful-paint", (e) => {
      v.lcp = Math.round(e.startTime);
    });
    observe("paint", (e) => {
      if (e.name === "first-contentful-paint") v.fcp = Math.round(e.startTime);
    });
    // CLS is a small float (0.05 is "good"). Stored as milli-CLS so it stays an
    // integer in props_num and survives the round-trip without float noise.
    let cls = 0;
    observe("layout-shift", (e) => {
      const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (!s.hadRecentInput) {
        cls += s.value;
        v.cls = Math.round(cls * 1000);
      }
    });
    observe("event", (e) => {
      const dur = Math.round(e.duration);
      if (dur > ((v.inp as number) ?? 0)) v.inp = dur;
    });

    try {
      const n0 = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      if (n0) v.ttfb = Math.round(n0.responseStart);
    } catch {
      /* ignore */
    }

    // Reported alongside the exit beacon so it costs no extra request.
    reportVitals = () => {
      if (Object.keys(v).length) track("$web_vitals", v);
    };
  }

  let reportVitals: (() => void) | undefined;

  /**
   * Dead click: the visitor clicked something that looks interactive and
   * nothing happened.
   *
   * Detected by consequence rather than by inspecting handlers — there is no
   * way to ask an element whether it has a listener. If, shortly after a click
   * on something button-like, the URL has not changed and the DOM has not
   * mutated, the click did nothing. That is the signal that finds a broken
   * button, a failed handler, or a link a designer styled but never wired.
   *
   * Only fires on elements that *appear* clickable, because a click on body
   * text is expected to do nothing and reporting it would drown the real ones.
   */
  function detectDeadClick(target: Element): void {
    if (!w.MutationObserver || !d.body) return;

    // A bare `[role]` rather than enumerating button/link/tab: it is shorter
    // *and* broader, catching menuitem, option, checkbox and every other
    // interactive role without listing them.
    const clickable = target.closest(
      "a,button,input,select,summary,[role],[onclick],[data-falorb]",
    );
    if (!clickable) return;

    // A disabled control is *supposed* to do nothing.
    if ((clickable as HTMLButtonElement).disabled) return;

    const urlBefore = location.href;
    let mutated = false;

    const observer = new MutationObserver(() => {
      mutated = true;
      observer.disconnect();
    });

    // childList + attributes covers everything that counts as "the page
    // reacted": inserted nodes, and class or style changes. characterData is
    // omitted deliberately — text edits without either of those are vanishingly
    // rare, and the bytes are better spent elsewhere.
    observer.observe(d.body, { childList: true, subtree: true, attributes: true });

    // 500ms is long enough for a synchronous handler, a route change or an
    // optimistic UI update, and short enough that a slow network request has
    // usually rendered a loading state by then.
    setTimeout(() => {
      observer.disconnect();
      if (mutated || location.href !== urlBefore) return;
      // No `tag` property: selectorOf already begins with the tag name.
      track("$dead_click", { selector: selectorOf(clickable), text: labelOf(clickable) });
    }, 500);
  }

  function selectorOf(el: Element): string {
    const id = el.id ? "#" + el.id : "";
    const cls =
      typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
    return (el.tagName.toLowerCase() + id + cls).slice(0, 120);
  }

  function labelOf(el: Element): string {
    return (el.textContent ?? "").trim().slice(0, 80);
  }

  // --- lifecycle -----------------------------------------------------------

  // visibilitychange, not unload: Safari and mobile Chrome frequently skip
  // unload/beforeunload entirely, which would silently lose every exit event
  // and with it all drop-off data.
  d.addEventListener("visibilitychange", () => {
    if (d.visibilityState === "hidden") {
      if (reportVitals) {
        reportVitals();
        reportVitals = undefined;
      }
      sendPageLeave();
      flush(true);
    } else {
      // Visible again — a tab switched back to, or a page restored from the
      // back/forward cache. The next exit is a genuine one rather than a
      // duplicate of the exit already reported, so the guard reopens. The
      // dwell timer is deliberately not restarted: duration has always been
      // measured from when the page was entered, and changing that here would
      // quietly redefine the metric.
      leaveSent = false;
    }
  });
  w.addEventListener("pagehide", () => {
    sendPageLeave();
    flush(true);
  });


  const api = function (method: string, ...args: unknown[]) {
    const fn = (api as unknown as Record<string, unknown>)[method];
    if (typeof fn === "function") (fn as (...a: unknown[]) => void)(...args);
  } as FalorbApi;

  api.track = track;
  api.page = page;
  api.identify = identify;
  api.group = group;
  api.revenue = revenue;
  api.reset = reset;
  api.consent = consent;

  // Drain anything the snippet queued before this script finished loading.
  const pending = w.falorb && w.falorb.q;
  w.falorb = api;
  if (pending) {
    for (let i = 0; i < pending.length; i++) {
      try {
        const call = pending[i] as unknown as unknown[];
        api(String(call[0]), ...Array.prototype.slice.call(call, 1));
      } catch {
        /* skip a malformed queued call */
      }
    }
  }

  if (autoCapture) autoInit();
  page();
})();

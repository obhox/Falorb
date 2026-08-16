import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * React bindings for the browser tracker.
 *
 * The tracker is a plain script and works without any of this. What React
 * apps actually need, and keep getting wrong when wiring it by hand, is:
 *
 *   - Route changes. The script patches `history`, but frameworks that render
 *     transitions without a history entry can still miss pageviews, so the
 *     provider exposes an explicit `page()` to call from a router effect.
 *   - Calls before the script loads. The queue stub handles this, but only if
 *     nothing tries to read `window.falorb` directly — hence the hook.
 *   - Identify running on every render. `identify()` triggers a server-side
 *     person merge; calling it in a bare `useEffect` with an object dependency
 *     re-fires it on each render and generates needless merge work. The
 *     provider dedupes.
 */

type Properties = Record<string, string | number | boolean | null | undefined>;

interface TrackerApi {
  (method: string, ...args: unknown[]): void;
  track?: (name: string, props?: Properties) => void;
  page?: (url?: string) => void;
  identify?: (userId: string, traits?: Properties) => void;
  group?: (groupId: string, traits?: Properties) => void;
  revenue?: (amount: number, currency?: string, props?: Properties) => void;
  reset?: () => void;
  consent?: (granted: boolean) => void;
  q?: unknown[];
}

declare global {
  interface Window {
    falorb?: TrackerApi;
  }
}

export interface FalorbContextValue {
  track: (name: string, properties?: Properties) => void;
  page: (url?: string) => void;
  identify: (userId: string, traits?: Properties) => void;
  group: (groupId: string, traits?: Properties) => void;
  revenue: (amount: number, currency?: string, properties?: Properties) => void;
  reset: () => void;
  setConsent: (granted: boolean) => void;
  /** False until the tracker script has loaded; calls before then are queued. */
  ready: boolean;
}

const FalorbContext = createContext<FalorbContextValue | null>(null);

export interface FalorbProviderProps {
  /** Project public key from the dashboard. */
  projectKey: string;
  /** Collector origin, e.g. https://a.example.com */
  host: string;
  children: ReactNode;
  /** Skip injecting the script — set when it is already in the page <head>. */
  scriptAlreadyLoaded?: boolean;
  /** Disable collection entirely, e.g. in preview environments. */
  enabled?: boolean;
  /** Other first-party domains to stitch identity across on outbound links. */
  crossDomain?: string[];
  /** Collect nothing until consent is granted. */
  requireConsent?: boolean;
  /** Store no cookie; identity lasts only for the tab. */
  cookieless?: boolean;
}

/**
 * Queue calls made before the script is ready.
 *
 * Installed synchronously on first render so an `identify()` in a layout
 * effect is not lost during the window before the script parses.
 */
function ensureStub(): void {
  if (typeof window === "undefined") return;
  if (window.falorb) return;
  const stub = function (...args: unknown[]) {
    (stub.q ??= []).push(args);
  } as TrackerApi;
  window.falorb = stub;
}

function call(method: keyof TrackerApi, args: unknown[]): void {
  if (typeof window === "undefined") return;
  const api = window.falorb;
  if (!api) return;

  const fn = api[method];
  if (typeof fn === "function") {
    (fn as (...a: unknown[]) => void)(...args);
  } else {
    // Still the stub — queue through its call signature so the real tracker
    // drains it on load.
    api(String(method), ...args);
  }
}

export function FalorbProvider({
  projectKey,
  host,
  children,
  scriptAlreadyLoaded,
  enabled = true,
  crossDomain,
  requireConsent,
  cookieless,
}: FalorbProviderProps) {
  const identified = useRef<string | null>(null);
  const readyRef = useRef(false);

  if (enabled) ensureStub();

  useEffect(() => {
    if (!enabled || scriptAlreadyLoaded || typeof document === "undefined") return;
    // Idempotent: React 18 strict mode mounts effects twice, and a second
    // script tag would double-count every pageview.
    if (document.querySelector(`script[data-project="${projectKey}"]`)) {
      readyRef.current = true;
      return;
    }

    const script = document.createElement("script");
    script.defer = true;
    script.src = `${host.replace(/\/$/, "")}/t.js`;
    script.dataset.project = projectKey;
    if (crossDomain?.length) script.dataset.crossDomain = crossDomain.join(",");
    if (requireConsent) script.dataset.consent = "opt-in";
    if (cookieless) script.dataset.cookieless = "1";
    script.addEventListener("load", () => {
      readyRef.current = true;
    });

    document.head.appendChild(script);
  }, [enabled, scriptAlreadyLoaded, projectKey, host, crossDomain, requireConsent, cookieless]);

  const value = useMemo<FalorbContextValue>(
    () => ({
      track: (name, properties) => enabled && call("track", [name, properties]),
      page: (url) => enabled && call("page", [url]),
      identify: (userId, traits) => {
        if (!enabled || !userId) return;
        // Deduped: identify triggers a server-side merge, and re-firing it on
        // every render would queue redundant work for no benefit.
        if (identified.current === userId && !traits) return;
        identified.current = userId;
        call("identify", [userId, traits]);
      },
      group: (groupId, traits) => enabled && call("group", [groupId, traits]),
      revenue: (amount, currency, properties) =>
        enabled && call("revenue", [amount, currency, properties]),
      reset: () => {
        identified.current = null;
        if (enabled) call("reset", []);
      },
      setConsent: (granted) => enabled && call("consent", [granted]),
      ready: readyRef.current,
    }),
    [enabled],
  );

  return <FalorbContext.Provider value={value}>{children}</FalorbContext.Provider>;
}

export function useFalorb(): FalorbContextValue {
  const context = useContext(FalorbContext);
  if (!context) {
    throw new Error("useFalorb must be used inside a <FalorbProvider>.");
  }
  return context;
}

/**
 * Report a pageview whenever the given path changes.
 *
 * Call from a component that observes the router:
 *
 *   usePageview(usePathname());          // Next.js app router
 *   usePageview(useLocation().pathname); // React Router
 *
 * The tracker already patches `history`, so this is only needed for routers
 * that render transitions without pushing a history entry — but it is safe to
 * use everywhere, since a repeat of the same path is ignored.
 */
export function usePageview(path: string | null | undefined): void {
  const { page } = useFalorb();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!path || path === last.current) return;
    last.current = path;
    page(path);
  }, [path, page]);
}

/**
 * Keep the identified user in sync with auth state.
 *
 * Passing null after sign-out calls `reset()`, so the next visitor on a shared
 * machine does not inherit the previous person's identity.
 */
export function useIdentify(
  user: { id: string; [key: string]: unknown } | null | undefined,
): void {
  const { identify, reset } = useFalorb();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      if (previous.current === user.id) return;
      previous.current = user.id;
      const { id, ...traits } = user;
      identify(id, traits as Properties);
    } else if (previous.current) {
      previous.current = null;
      reset();
    }
  }, [user, identify, reset]);
}

/** Stable callback for tracking an event from a handler. */
export function useTrackEvent(
  name: string,
  properties?: Properties,
): () => void {
  const { track } = useFalorb();
  return useCallback(() => track(name, properties), [track, name, properties]);
}

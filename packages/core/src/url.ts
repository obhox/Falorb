/**
 * URL parsing helpers shared by ingest and the dashboard's query layer.
 * Everything here must be total — a malformed URL from a hostile client must
 * degrade to empty strings, never throw on the ingest hot path.
 */

export interface ParsedUrl {
  url: string;
  host: string;
  path: string;
  query: string;
  hash: string;
}

/** Query parameters stripped from stored URLs — tracking noise, not analysis. */
const NOISE_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "dclid",
  "twclid",
  "ttclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "yclid",
  "li_fat_id",
  "epik",
  "s_kwcid",
  "_falorb_l",
]);

export function parseUrl(raw: string | undefined): ParsedUrl {
  if (!raw) return { url: "", host: "", path: "", query: "", hash: "" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw.slice(0, 2048), host: "", path: "", query: "", hash: "" };
  }

  for (const key of [...u.searchParams.keys()]) {
    if (NOISE_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }

  return {
    url: u.toString(),
    host: u.hostname.toLowerCase().replace(/^www\./, ""),
    path: normalizePath(u.pathname),
    query: u.search.replace(/^\?/, ""),
    hash: u.hash.replace(/^#/, ""),
  };
}

/**
 * Collapse a pathname to its canonical form: lowercase, no trailing slash,
 * no duplicate separators. `/Blog/Post/` and `/blog/post` must aggregate into
 * one row or every top-pages report is wrong.
 */
export function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  let p = pathname.replace(/\/{2,}/g, "/").toLowerCase();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

export interface Utm {
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
}

const EMPTY_UTM: Utm = {
  source: "",
  medium: "",
  campaign: "",
  term: "",
  content: "",
};

export function parseUtm(raw: string | undefined): Utm {
  if (!raw) return { ...EMPTY_UTM };
  let params: URLSearchParams;
  try {
    params = new URL(raw).searchParams;
  } catch {
    return { ...EMPTY_UTM };
  }

  const get = (...names: string[]): string => {
    for (const n of names) {
      const v = params.get(n);
      if (v) return v.slice(0, 255).toLowerCase();
    }
    return "";
  };

  return {
    // `ref` and `source` are the conventions Plausible-style setups use; accept
    // them so sites already tagged that way keep working after switching.
    source: get("utm_source", "ref", "source"),
    medium: get("utm_medium", "medium"),
    campaign: get("utm_campaign", "campaign"),
    term: get("utm_term", "term"),
    content: get("utm_content", "content"),
  };
}

/**
 * Detect a likely file download from a URL. Used by the tracker to classify
 * clicks and by ingest to sanity-check the tracker's classification.
 */
const DOWNLOAD_EXT =
  /\.(pdf|zip|rar|7z|tar|gz|dmg|pkg|exe|msi|apk|csv|xlsx?|docx?|pptx?|mp3|mp4|mov|avi|wav|epub)$/i;

export function isDownloadUrl(raw: string): boolean {
  try {
    return DOWNLOAD_EXT.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

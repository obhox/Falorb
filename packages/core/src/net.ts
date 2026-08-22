/**
 * Destination safety for outbound requests the product makes on a user's
 * behalf — today that is alert webhooks, configured by any member and then
 * POSTed to by the worker from *inside* the compose network.
 *
 * The threat is server-side request forgery. From the worker's vantage point
 * `https://clickhouse:8123`, `https://postgres:5432` and the cloud metadata
 * endpoint at 169.254.169.254 are all reachable, and none of them are
 * reachable from the internet. A scheme check alone does not help: an attacker
 * controls their own DNS, so `https://evil.example` can resolve to
 * 127.0.0.1, and can equally answer with a 302 into the private range.
 *
 * Defence is therefore in two parts, deliberately split by what each layer can
 * know:
 *
 *   - This module is **pure**. It parses and classifies addresses and screens
 *     URL syntax, with no I/O and no Node built-ins, so it is safe to import
 *     from anywhere including a browser bundle. It runs at configuration time,
 *     where it gives the user an immediate, comprehensible error.
 *
 *   - Resolution-time enforcement lives with the caller that actually makes the
 *     request (`apps/worker/src/net.ts`), because only that layer can perform
 *     DNS and only it knows what the name resolved to *this time*. A check
 *     performed only at configuration time is defeated by DNS rebinding.
 *
 * Both layers are required. Neither is sufficient.
 */

export class UnsafeUrlError extends Error {}

/** Reject octal-ambiguous and out-of-range forms rather than guessing. */
function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // "010" is 8 in some resolvers and 10 in others. Ambiguity here is how
    // filters get bypassed, so it is simply refused.
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * True for any IPv4 address that is not ordinary public unicast.
 *
 * Covers loopback, the RFC 1918 ranges, carrier-grade NAT, link-local — which
 * is where every cloud metadata service lives — the documentation and
 * benchmark ranges, multicast and the reserved top block.
 */
export function isPrivateIpv4(value: string): boolean {
  const o = parseIpv4(value);
  if (!o) return true; // unparseable is not demonstrably public
  const [a, b] = o as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 192 && b === 0) return true; // IETF protocol assignments + TEST-NET-1
  if (a === 192 && b === 88) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

/** True for any IPv6 address that is not ordinary public unicast. */
export function isPrivateIpv6(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";

  // IPv4-mapped and IPv4-compatible forms carry a v4 address inside a v6
  // literal; classify by the address that will actually be dialled.
  const embedded = /(?:^::ffff:|^::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(address);
  if (embedded?.[1]) return isPrivateIpv4(embedded[1]);

  if (address === "::" || address === "::1") return true;
  if (/^f[cd]/.test(address)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(address)) return true; // fe80::/10 link-local
  if (/^ff/.test(address)) return true; // ff00::/8 multicast
  if (address.startsWith("64:ff9b:")) return true; // NAT64
  if (address.startsWith("2001:db8:")) return true; // documentation

  return false;
}

export function isPrivateAddress(value: string): boolean {
  return value.includes(":") ? isPrivateIpv6(value) : isPrivateIpv4(value);
}

/**
 * Hostnames that never denote a public destination, whatever DNS says.
 *
 * `.internal` covers GCP's metadata name; the rest are the conventional
 * private-network suffixes. This is a convenience for a clear error message at
 * configuration time — the resolution-time check is what actually enforces it.
 */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".localdomain",
];

/**
 * Screen a user-supplied outbound URL on syntax alone.
 *
 * Anywhere this product takes a destination from a customer and then has a
 * server open a connection to it, this is the first gate: alert channels,
 * outbound webhooks, and the base URL of a self-hosted integration all reach
 * the same private network from the inside, and all reach it identically.
 * Having one screen rather than one per feature is the point — the ops-webhook
 * path had none for exactly as long as it was the one feature that forgot.
 *
 * Syntax alone is deliberately not the whole defence. A hostname's resolution
 * is not fixed and a public host can redirect into the private range, so
 * anything that actually opens a socket must re-check at resolution time; see
 * `apps/worker/src/net.ts`.
 *
 * `label` only shapes the error message, which is read by the person pasting
 * the URL into a form. Returns the parsed URL so callers do not re-parse.
 */
export function assertSafeOutboundUrl(raw: string, label = "webhook target"): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeUrlError(
      `A ${label} must use https:// so its contents and credentials are not sent in the clear.`,
    );
  }

  // Credentials in the URL end up in logs and in the stored row.
  if (url.username || url.password) {
    throw new UnsafeUrlError("Remove the username and password from the URL; use the secret field instead.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError(`That host is on a private network and is not reachable as a ${label}.`);
  }

  // A bare hostname with no dot is a container or LAN name (`clickhouse`,
  // `postgres`), never a public destination.
  if (!host.includes(".") && !host.includes(":")) {
    throw new UnsafeUrlError("Enter a fully-qualified public hostname.");
  }

  // An IP literal can be classified right now, with no DNS involved.
  const looksLikeIp = /^[\d.]+$/.test(host) || host.includes(":");
  if (looksLikeIp && isPrivateAddress(host)) {
    throw new UnsafeUrlError(`That address is on a private network and is not reachable as a ${label}.`);
  }

  return url;
}

/**
 * The webhook-worded spelling of `assertSafeOutboundUrl`.
 *
 * Kept as the name the alert-channel and webhook call sites use, so the check
 * reads as what it is at those sites rather than as a generic utility.
 */
export function assertSafeWebhookUrl(raw: string): URL {
  return assertSafeOutboundUrl(raw, "webhook target");
}

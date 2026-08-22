import { lookup } from "node:dns/promises";
import { assertSafeWebhookUrl, isPrivateAddress, UnsafeUrlError } from "@falorb/core";

/**
 * Resolution-time SSRF enforcement for outbound webhooks.
 *
 * The syntactic screen in `@falorb/core` runs when a channel is saved. It
 * cannot be the only check, for two reasons that both matter:
 *
 *   A hostname's resolution is not fixed. `assertSafeWebhookUrl` accepted
 *   `hooks.example.com` at configuration time; nothing stops its owner from
 *   repointing it at 127.0.0.1 an hour later. That is DNS rebinding, and only
 *   a check performed immediately before the socket is opened defeats it.
 *
 *   A public host can redirect into the private range. `fetch` follows
 *   redirects by default and performs no per-hop policy, so the guard has to
 *   take over redirect handling itself.
 *
 * Every hop is therefore resolved and classified here, and the chain is walked
 * manually with a bounded hop count.
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Resolve a host and refuse anything that is not public unicast.
 *
 * Both address families are requested: a host with a public A record and a
 * loopback AAAA record would otherwise pass while the connection actually goes
 * to the private address, since the runtime picks the family itself.
 */
async function assertResolvesPublic(hostname: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${hostname}.`);
  }

  if (!addresses.length) throw new UnsafeUrlError(`${hostname} resolved to no addresses.`);

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new UnsafeUrlError(`${hostname} resolves to the private address ${address}.`);
    }
  }
}

/**
 * POST to a user-configured webhook, enforcing destination policy on every
 * hop. Returns the final response; throws `UnsafeUrlError` if the chain ever
 * points somewhere it should not.
 */
export async function postWebhook(
  rawUrl: string,
  init: { headers: Record<string, string>; body: string; timeoutMs?: number },
): Promise<Response> {
  let url = assertSafeWebhookUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertResolvesPublic(url.hostname);

    const response = await fetch(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      // Redirects are walked by hand so each hop is re-screened. `fetch`'s own
      // following would jump straight past this guard.
      redirect: "manual",
      // Per hop rather than for the whole chain. A destination that stalls on
      // every redirect still finishes bounded, because the hop count is.
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }

    if (hop === MAX_REDIRECTS) {
      throw new UnsafeUrlError(`Too many redirects from ${rawUrl}.`);
    }

    // Re-screen the target syntactically as well: a relative Location resolves
    // against the current URL, and an absolute one may switch scheme or host.
    url = assertSafeWebhookUrl(new URL(location, url).toString());
  }

  throw new UnsafeUrlError(`Too many redirects from ${rawUrl}.`);
}

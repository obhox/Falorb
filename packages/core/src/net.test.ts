import { describe, expect, it } from "vitest";
import { assertSafeOutboundUrl, assertSafeWebhookUrl, isPrivateAddress, UnsafeUrlError } from "./net";

/**
 * These cover the syntactic half of the webhook SSRF guard. The half that
 * resolves DNS lives in `apps/worker/src/net.ts` and cannot be exercised here
 * without a network, but the classifier it depends on is pure and is what these
 * tests pin down: if `isPrivateAddress` ever stops recognising a range, the
 * resolution-time check silently starts letting it through.
 */

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "RFC 1918"],
    ["172.16.0.1", "RFC 1918 lower bound"],
    ["172.31.255.255", "RFC 1918 upper bound"],
    ["192.168.1.1", "RFC 1918"],
    ["169.254.169.254", "link-local — the cloud metadata endpoint"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["0.0.0.0", "this network"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["::1", "IPv6 loopback"],
    ["fd00::1", "IPv6 unique local"],
    ["fe80::1", "IPv6 link-local"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
  ])("treats %s as private (%s)", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([["8.8.8.8"], ["1.1.1.1"], ["93.184.216.34"], ["2606:4700::1111"]])(
    "treats %s as public",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("refuses octal-ambiguous octets rather than guessing how a resolver reads them", () => {
    // "010" is 8 to one parser and 10 to another; disagreement between the
    // filter and the socket is exactly how these guards get bypassed.
    expect(isPrivateAddress("010.0.0.1")).toBe(true);
  });

  it("treats 172.32.x as public, so the RFC 1918 bound is not off by one", () => {
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("172.15.0.1")).toBe(false);
  });
});

describe("assertSafeWebhookUrl", () => {
  it("accepts an ordinary public https endpoint", () => {
    expect(assertSafeWebhookUrl("https://hooks.slack.com/services/T/B/x").hostname).toBe(
      "hooks.slack.com",
    );
  });

  it.each([
    ["http://hooks.slack.com/x", "plaintext http"],
    ["https://localhost/x", "localhost by name"],
    ["https://clickhouse:8123/x", "a bare container name"],
    ["https://postgres/x", "a bare service name"],
    ["https://metadata.internal/x", "the .internal suffix"],
    ["https://box.local/x", "the .local suffix"],
    ["https://127.0.0.1/x", "loopback as a literal"],
    ["https://169.254.169.254/latest/meta-data/", "the metadata endpoint"],
    ["https://192.168.0.5/x", "a private literal"],
    ["https://[::1]/x", "IPv6 loopback as a literal"],
    ["https://user:pass@hooks.example.com/x", "embedded credentials"],
    ["not a url", "unparseable input"],
  ])("rejects %s (%s)", (raw) => {
    expect(() => assertSafeWebhookUrl(raw)).toThrow(UnsafeUrlError);
  });

  it("explains the refusal in terms the person pasting the URL can act on", () => {
    expect(() => assertSafeWebhookUrl("http://hooks.slack.com/x")).toThrow(/https/i);
  });
});

/**
 * The same screen, reached by its general name. Every destination a customer
 * can point this product at — an alert channel, an outbound webhook, a
 * self-hosted integration's base URL — reaches the private network the same
 * way, so they share one implementation rather than one screen per feature.
 * The ops-webhook path had none for exactly as long as it was the feature that
 * forgot.
 */
describe("assertSafeOutboundUrl", () => {
  it("accepts a self-hosted deployment on a public host", () => {
    expect(assertSafeOutboundUrl("https://linki.example.com", "Linki deployment").hostname).toBe(
      "linki.example.com",
    );
  });

  it.each([
    ["http://linki.example.com", "plaintext http, which would send the credential in the clear"],
    ["https://redis:6379", "a bare container name"],
    ["https://169.254.169.254/", "the cloud metadata endpoint"],
    ["https://10.0.0.7:8123/?query=SELECT%201", "a private literal with a query"],
    ["https://localhost:3000", "localhost by name"],
  ])("rejects %s (%s)", (raw) => {
    expect(() => assertSafeOutboundUrl(raw, "Linki deployment")).toThrow(UnsafeUrlError);
  });

  it("names the destination it is refusing, so the error fits the form it came from", () => {
    expect(() => assertSafeOutboundUrl("https://10.0.0.7", "Linki deployment")).toThrow(
      /Linki deployment/,
    );
  });

  it("agrees with the webhook spelling on every case", () => {
    for (const raw of [
      "https://hooks.slack.com/services/T/B/x",
      "http://hooks.slack.com/x",
      "https://127.0.0.1/x",
      "https://clickhouse:8123/x",
    ]) {
      const outbound = safely(() => assertSafeOutboundUrl(raw));
      const webhook = safely(() => assertSafeWebhookUrl(raw));
      expect(outbound).toBe(webhook);
    }
  });
});

function safely(fn: () => URL): string {
  try {
    return fn().toString();
  } catch (error) {
    return error instanceof UnsafeUrlError ? "refused" : "threw";
  }
}

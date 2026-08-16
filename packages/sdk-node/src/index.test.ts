import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Falorb } from "./index";

/**
 * The properties worth guarding here are the safety ones. A server SDK sits
 * inside someone's request path, so "never throws" and "never blocks" matter
 * more than any individual field being right.
 */

let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
let respondWith: { ok: boolean; status: number } | Error = { ok: true, status: 204 };

beforeEach(() => {
  sent = [];
  respondWith = { ok: true, status: 204 };
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    if (respondWith instanceof Error) throw respondWith;
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: respondWith.ok, status: respondWith.status };
  });
});

afterEach(() => vi.unstubAllGlobals());

function client(overrides = {}) {
  return new Falorb({
    projectKey: "prj_test",
    host: "https://a.example.com",
    flushInterval: 1_000_000, // never fires during a test
    onError: () => {},
    ...overrides,
  });
}

describe("Falorb server SDK", () => {
  it("sends a tracked event to the collector", async () => {
    const f = client();
    f.track("subscription_upgraded", { userId: "user_1", properties: { plan: "pro" } });
    await f.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://a.example.com/e");
    expect(sent[0]!.body.k).toBe("prj_test");
    expect(sent[0]!.body.i).toBe("user_1");
    const events = sent[0]!.body.e as Array<Record<string, unknown>>;
    expect(events[0]!.n).toBe("subscription_upgraded");
    expect(events[0]!.p).toEqual({ plan: "pro" });
  });

  it("never leaks the internal identity marker onto the wire", async () => {
    const f = client();
    f.track("thing", { userId: "user_1" });
    await f.flush();
    expect(JSON.stringify(sent[0]!.body)).not.toContain("__identity");
  });

  it("groups events by person, since one batch carries one identity", async () => {
    const f = client();
    f.track("a", { userId: "user_1" });
    f.track("b", { userId: "user_2" });
    f.track("c", { userId: "user_1" });
    await f.flush();

    expect(sent).toHaveLength(2);
    const byUser = Object.fromEntries(
      sent.map((s) => [s.body.i, (s.body.e as unknown[]).length]),
    );
    expect(byUser).toEqual({ user_1: 2, user_2: 1 });
  });

  it("derives a stable device id from the user id", async () => {
    const f = client();
    f.track("a", { userId: "user_1" });
    await f.flush();
    const first = sent[0]!.body.d;

    sent = [];
    f.track("b", { userId: "user_1" });
    await f.flush();
    // A new device id per call would fragment the person across many rows.
    expect(sent[0]!.body.d).toBe(first);
  });

  it("flushes automatically once the batch size is reached", async () => {
    const f = client({ batchSize: 3 });
    f.track("a", { userId: "u" });
    f.track("b", { userId: "u" });
    expect(sent).toHaveLength(0);
    f.track("c", { userId: "u" });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it("drops an event with no identity rather than inventing one", async () => {
    const errors: Error[] = [];
    const f = client({ onError: (e: Error) => errors.push(e) });
    f.track("orphan");
    await f.flush();

    expect(sent).toHaveLength(0);
    expect(errors[0]!.message).toContain("needs a userId or deviceId");
  });

  it("does not throw when the collector is unreachable", async () => {
    respondWith = new Error("ECONNREFUSED");
    const errors: Error[] = [];
    const f = client({ onError: (e: Error) => errors.push(e) });
    f.track("a", { userId: "u" });

    // The whole point: a dead collector must not break the caller's request.
    await expect(f.flush()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("reports a non-2xx response without throwing", async () => {
    respondWith = { ok: false, status: 500 };
    const errors: Error[] = [];
    const f = client({ onError: (e: Error) => errors.push(e) });
    f.track("a", { userId: "u" });
    await f.flush();
    expect(errors[0]!.message).toContain("500");
  });

  it("attaches revenue with its currency", async () => {
    const f = client();
    f.revenue(99.5, { userId: "u", currency: "GBP" });
    await f.flush();
    const events = sent[0]!.body.e as Array<Record<string, unknown>>;
    expect(events[0]).toMatchObject({ n: "$revenue", rv: 99.5, cu: "GBP" });
  });

  it("collects nothing when disabled", async () => {
    const f = client({ enabled: false });
    f.track("a", { userId: "u" });
    await f.flush();
    expect(sent).toHaveLength(0);
  });

  it("flushes on shutdown", async () => {
    const f = client();
    f.track("a", { userId: "u" });
    await f.shutdown();
    expect(sent).toHaveLength(1);
  });

  it("refuses to construct without a project key", () => {
    expect(() => new Falorb({ projectKey: "", host: "https://x" })).toThrow(/projectKey/);
  });
});

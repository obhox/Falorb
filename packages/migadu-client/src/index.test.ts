import { afterEach, describe, expect, it, vi } from "vitest";
import { MigaduApiError, MigaduClient } from "./index";

interface Call {
  method: string;
  url: string;
  authHeader: string | null;
}

function mockMigadu(handler: (call: Call) => { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { method: string; headers: Record<string, string> }) => {
    const call: Call = { method: init.method, url, authHeader: init.headers["Authorization"] ?? null };
    calls.push(call);
    const reply = handler(call);
    return {
      ok: reply.status < 400,
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response;
  });
  return calls;
}

const credential = (username = "admin@example.com", apiKey = "secret-key") =>
  JSON.stringify({ username, apiKey });

const client = () => new MigaduClient({ baseUrl: "https://api.migadu.com/v1", apiKey: credential() });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MigaduClient", () => {
  it("authenticates with HTTP Basic auth built from the JSON-encoded username/apiKey pair", async () => {
    const calls = mockMigadu(() => ({ status: 200, body: { domains: [] } }));

    await client().listDomains();

    const expected = `Basic ${Buffer.from("admin@example.com:secret-key").toString("base64")}`;
    expect(calls[0]!.authHeader).toBe(expected);
  });

  it("lists domains from the domains envelope", async () => {
    mockMigadu(() => ({ status: 200, body: { domains: [{ domain_name: "example.com" }] } }));

    const domains = await client().listDomains();
    expect(domains).toEqual([{ domain_name: "example.com" }]);
  });

  it("creates a mailbox with the given local part and password, never auto-generated", async () => {
    let sentBody: unknown;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, status: 201, json: async () => ({ local_part: "sales", domain_name: "example.com", address: "sales@example.com", name: "Sales" }) } as unknown as Response;
    });

    const mailbox = await client().createMailbox("example.com", { localPart: "sales", name: "Sales", password: "s3cret!" });

    expect(mailbox.address).toBe("sales@example.com");
    expect(sentBody).toMatchObject({ local_part: "sales", password: "s3cret!", password_use_auto: false });
  });

  it("surfaces a rejected key as a failed verifyConnection rather than throwing", async () => {
    mockMigadu(() => ({ status: 401, body: { error: "invalid credentials" } }));

    const result = await client().verifyConnection();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("401");
  });

  it("reports a healthy key through verifyConnection", async () => {
    mockMigadu(() => ({ status: 200, body: { domains: [{ domain_name: "example.com" }] } }));

    const result = await client().verifyConnection();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("1 domain");
  });

  it("rejects a malformed (non-JSON) credential at construction time", () => {
    expect(() => new MigaduClient({ baseUrl: "https://api.migadu.com/v1", apiKey: "not-json" })).toThrow(
      /Malformed Migadu credential/,
    );
  });
});

describe("MigaduApiError", () => {
  it("carries the status and body through to the message", () => {
    const error = new MigaduApiError(422, { error: "local_part taken" });
    expect(error.message).toContain("422");
    expect(error.message).toContain("local_part taken");
  });
});

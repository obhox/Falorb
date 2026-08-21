import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferApiError, BufferClient } from "./index";
import { INTROSPECTION } from "./schema.fixture";

interface Call {
  query: string;
  variables: Record<string, unknown>;
}

type Reply = { data?: unknown; errors?: unknown[]; status?: number };

/**
 * Stands a fake Buffer in front of the client: `handler` sees each GraphQL
 * request in order and answers it. Every assertion in this file is about the
 * query the client *chose to send*, which is the part a live account would
 * otherwise be the only way to check.
 */
function mockBuffer(handler: (call: Call, index: number) => Reply): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const parsed = JSON.parse(init.body) as Call;
    calls.push({ query: parsed.query, variables: parsed.variables ?? {} });
    const reply = handler(parsed, calls.length - 1);
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      headers: new Headers(),
      json: async () => ({ data: reply.data, errors: reply.errors }),
      text: async () => JSON.stringify(reply),
    } as unknown as Response;
  });
  return calls;
}

const client = () => new BufferClient({ baseUrl: "https://api.buffer.com", apiKey: "key", maxRetries: 0 });

const ACCOUNT = {
  account: { id: "a_1", email: "you@example.com", name: "You", organizations: [{ id: "org_1", name: "Falorb" }] },
};

const WEEKLY_LIMIT_ERROR = [
  {
    message:
      'Field "weeklyPostingLimit" of type "WeeklyPostingLimit" must have a selection of subfields. Did you mean "weeklyPostingLimit { ... }"?',
    locations: [{ line: 3, column: 84 }],
    extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listChannels", () => {
  it("builds the selection and arguments from the live schema", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      if (call.query.includes("account")) return { data: ACCOUNT };
      return {
        data: {
          channels: [
            { id: "ch_1", name: "falorb", service: "twitter", isDisconnected: false, weeklyPostingLimit: { limit: 7, remaining: 2 } },
          ],
        },
      };
    });

    const channels = await client().listChannels();

    const channelsQuery = calls.at(-1)!;
    // The whole point: the object-typed field is asked for with subfields, and
    // the organization argument the schema requires is supplied.
    expect(channelsQuery.query).toContain("weeklyPostingLimit { limit remaining }");
    expect(channelsQuery.query).toContain("channels(organizationId: $organizationId)");
    expect(channelsQuery.variables).toEqual({ organizationId: "org_1" });
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ id: "ch_1", weeklyPostingLimit: 7, organizationId: "org_1" });
  });

  it("drops a field Buffer rejects and retries instead of failing the sync", async () => {
    // A schema that still claims `weeklyPostingLimit` is an Int while the
    // server has already promoted it to an object — the exact skew that
    // produced the HTTP 200 validation error in production.
    const stale = structuredClone(INTROSPECTION);
    const channel = stale.__schema.types?.find((t) => t.name === "Channel");
    const limitField = channel?.fields?.find((f) => f.name === "weeklyPostingLimit");
    if (limitField) limitField.type = { kind: "SCALAR", name: "Int", ofType: null };

    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: stale };
      if (call.query.includes("account")) return { data: ACCOUNT };
      if (call.query.includes("weeklyPostingLimit")) return { errors: WEEKLY_LIMIT_ERROR };
      return { data: { channels: [{ id: "ch_1", name: "falorb" }] } };
    });

    const channels = await client().listChannels();

    expect(channels).toHaveLength(1);
    expect(channels[0]?.weeklyPostingLimit).toBeNull();
    expect(calls.at(-1)!.query).not.toContain("weeklyPostingLimit");
  });

  it("falls back to documented queries when introspection is unavailable", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { errors: [{ message: "Introspection is disabled" }] };
      return { data: { channels: [{ id: "ch_1", displayName: "Falorb" }] } };
    });

    const channels = await client().listChannels();

    expect(channels).toHaveLength(1);
    // Nothing object-typed is asked for blind — a sync that runs beats a field
    // whose shape we couldn't check.
    expect(calls.at(-1)!.query).not.toContain("weeklyPostingLimit");
  });
});

describe("listPosts", () => {
  it("walks the connection until Buffer says there is no next page", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      const after = call.variables.after as string | undefined;
      return after
        ? {
            data: {
              posts: {
                edges: [{ node: { id: "p_2", text: "two", channel: { id: "ch_1" } } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }
        : {
            data: {
              posts: {
                edges: [{ node: { id: "p_1", text: "one", channel: { id: "ch_1" } } }],
                pageInfo: { hasNextPage: true, endCursor: "cursor_1" },
              },
            },
          };
    });

    const posts = await client().listPosts({ channelId: "ch_1" });

    expect(posts.map((p) => p.id)).toEqual(["p_1", "p_2"]);
    expect(calls.at(-1)!.variables.after).toBe("cursor_1");
    expect(calls[1]!.query).toContain("edges { node {");
  });
});

describe("createPost", () => {
  it("sends only the input fields the mutation declares, with the schema's own enum member", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { data: { createPost: { __typename: "Post", id: "p_1", text: "hello", channel: { id: "ch_1" } } } };
    });

    const post = await client().createPost({ channelId: "ch_1", text: "hello", mode: "draft" });

    expect(post.id).toBe("p_1");
    // `mode` isn't an input field on this schema, and `schedulingType` is an
    // enum whose members are upper-case — both decided by introspection, not
    // by a guess in the client.
    expect(calls.at(-1)!.variables.input).toEqual({ channelId: "ch_1", text: "hello", schedulingType: "DRAFT" });
    expect(calls.at(-1)!.query).toContain("... on Post {");
  });

  it("raises the error member of a union payload rather than returning a post-shaped nothing", async () => {
    mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { data: { createPost: { __typename: "InvalidInputError", message: "Text is too long" } } };
    });

    await expect(client().createPost({ channelId: "ch_1", text: "x" })).rejects.toThrow(/Text is too long/);
  });

  it("surfaces a GraphQL error returned with HTTP 200", async () => {
    mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { errors: [{ message: "Channel is disconnected" }] };
    });

    await expect(client().createPost({ channelId: "ch_1", text: "x" })).rejects.toBeInstanceOf(BufferApiError);
  });
});

describe("verifyConnection", () => {
  it("reports who the key belongs to and how many organizations it can see", async () => {
    mockBuffer((call) => (call.query.includes("__schema") ? { data: INTROSPECTION } : { data: ACCOUNT }));

    const result = await client().verifyConnection();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("you@example.com");
    expect(result.detail).toContain("1 organization");
  });

  it("reads organizations whether they arrive as a list or a connection", async () => {
    // Same wish list, a connection-shaped Account: the selection adapts and
    // `extractNodes` unwraps the edges.
    const connectionShaped = structuredClone(INTROSPECTION);
    const account = connectionShaped.__schema.types?.find((t) => t.name === "Account");
    const organizations = account?.fields?.find((f) => f.name === "organizations");
    if (organizations) organizations.type = { kind: "OBJECT", name: "OrganizationConnection", ofType: null };
    connectionShaped.__schema.types?.push(
      {
        kind: "OBJECT",
        name: "OrganizationConnection",
        fields: [{ name: "edges", args: [], type: { kind: "LIST", name: null, ofType: { kind: "OBJECT", name: "OrganizationEdge", ofType: null } } }],
      },
      {
        kind: "OBJECT",
        name: "OrganizationEdge",
        fields: [{ name: "node", args: [], type: { kind: "OBJECT", name: "Organization", ofType: null } }],
      },
    );

    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: connectionShaped };
      return {
        data: { account: { id: "a_1", email: "you@example.com", organizations: { edges: [{ node: { id: "org_7", name: "Seven" } }] } } },
      };
    });

    const organizationsRead = await client().listOrganizations();

    expect(organizationsRead).toEqual([{ id: "org_7", name: "Seven" }]);
    expect(calls.at(-1)!.query).toContain("organizations { edges { node { id name } } }");
  });

  it("reports a rejected key rather than throwing", async () => {
    mockBuffer(() => ({ status: 401, errors: [{ message: "Unauthorized" }] }));

    const result = await client().verifyConnection();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("401");
  });
});

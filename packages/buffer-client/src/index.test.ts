import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferApiError, BufferClient } from "./index";
import { FLAT_INTROSPECTION, INTROSPECTION } from "./schema.fixture";

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
  it("scopes the query to each organization the input object requires", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      if (call.query.includes("account")) return { data: ACCOUNT };
      return {
        data: {
          channels: [
            {
              id: "ch_1",
              name: "falorb",
              service: "twitter",
              isDisconnected: false,
              weeklyPostingLimit: { limit: 7, scheduled: 2, sent: 3 },
            },
          ],
        },
      };
    });

    const channels = await client().listChannels();

    const channelsQuery = calls.at(-1)!;
    // The whole point: the object-typed field is asked for with subfields, and
    // the organization id lands inside the input object that requires it —
    // sending `input: {}` is what Buffer rejected in production.
    expect(channelsQuery.query).toContain("weeklyPostingLimit { limit scheduled sent }");
    expect(channelsQuery.query).toContain("channels(input: $input)");
    expect(channelsQuery.variables).toEqual({ input: { organizationId: "org_1" } });
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ id: "ch_1", weeklyPostingLimit: 7, organizationId: "org_1" });
  });

  it("passes the organization as a plain argument on a schema that takes one", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: FLAT_INTROSPECTION };
      if (call.query.includes("account")) return { data: ACCOUNT };
      return { data: { channels: [{ id: "ch_1", name: "falorb" }] } };
    });

    await client().listChannels();

    expect(calls.at(-1)!.query).toContain("channels(organizationId: $organizationId)");
    expect(calls.at(-1)!.variables).toEqual({ organizationId: "org_1" });
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
  it("filters by channel through the nested filter the live schema declares", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      if (call.query.includes("account")) return { data: ACCOUNT };
      return {
        data: {
          posts: {
            edges: [{ node: { id: "p_1", text: "one", channelId: "ch_1" } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    });

    const posts = await client().listPosts({ channelId: "ch_1" });

    expect(posts.map((p) => p.id)).toEqual(["p_1"]);
    // A flat `channelId` is silently ignored by Buffer, which is how one
    // channel's sync ends up holding every post in the organization.
    expect(calls.at(-1)!.variables.input).toEqual({
      filter: { channelIds: ["ch_1"] },
      organizationId: "org_1",
    });
  });

  it("walks the connection until Buffer says there is no next page", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      if (call.query.includes("account")) return { data: ACCOUNT };
      const after = call.variables.after as string | undefined;
      return after
        ? {
            data: {
              posts: {
                edges: [{ node: { id: "p_2", text: "two", channelId: "ch_1" } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }
        : {
            data: {
              posts: {
                edges: [{ node: { id: "p_1", text: "one", channelId: "ch_1" } }],
                pageInfo: { hasNextPage: true, endCursor: "cursor_1" },
              },
            },
          };
    });

    const posts = await client().listPosts({ channelId: "ch_1" });

    expect(posts.map((p) => p.id)).toEqual(["p_1", "p_2"]);
    expect(calls.at(-1)!.variables.after).toBe("cursor_1");
    expect(calls.at(-1)!.query).toContain("edges { node {");
  });
});

describe("createPost", () => {
  it("sends every field the live mutation requires, with the schema's own enum members", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return {
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: { id: "p_1", text: "hello", status: "draft", channelId: "ch_1" },
          },
        },
      };
    });

    const post = await client().createPost({ channelId: "ch_1", text: "hello", mode: "draft" });

    expect(post.id).toBe("p_1");
    // `mode` is Buffer's ShareMode and has no draft member, so a draft is a
    // queued post with `saveToDraft`; `schedulingType` is automatic-vs-
    // notification, not queue-vs-draft. Both come from introspection.
    expect(calls.at(-1)!.variables.input).toEqual({
      assets: [],
      channelId: "ch_1",
      mode: "addToQueue",
      needsApproval: false,
      saveToDraft: true,
      schedulingType: "automatic",
      text: "hello",
    });
    // The success member wraps the post rather than being one.
    expect(calls.at(-1)!.query).toContain("... on PostActionSuccess { post {");
  });

  it("schedules at a time when given one", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { data: { createPost: { __typename: "PostActionSuccess", post: { id: "p_2", text: "later" } } } };
    });

    await client().createPost({ channelId: "ch_1", text: "later", dueAt: "2026-09-01T10:00:00.000Z" });

    expect(calls.at(-1)!.variables.input).toMatchObject({
      dueAt: "2026-09-01T10:00:00.000Z",
      mode: "customScheduled",
    });
  });

  it("sends only what an older, flat schema declares", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: FLAT_INTROSPECTION };
      return { data: { createPost: { __typename: "Post", id: "p_1", text: "hello", channel: { id: "ch_1" } } } };
    });

    const post = await client().createPost({ channelId: "ch_1", text: "hello", mode: "draft" });

    expect(post.id).toBe("p_1");
    expect(calls.at(-1)!.variables.input).toEqual({ channelId: "ch_1", text: "hello", schedulingType: "SCHEDULED" });
    expect(calls.at(-1)!.query).toContain("... on Post {");
  });

  it("raises the error member of a union payload rather than returning a post-shaped nothing", async () => {
    mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { data: { createPost: { __typename: "NotFoundError", message: "Channel not found" } } };
    });

    await expect(client().createPost({ channelId: "ch_1", text: "x" })).rejects.toThrow(/Channel not found/);
  });

  it("surfaces a GraphQL error returned with HTTP 200", async () => {
    mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { errors: [{ message: "Channel is disconnected" }] };
    });

    await expect(client().createPost({ channelId: "ch_1", text: "x" })).rejects.toBeInstanceOf(BufferApiError);
  });
});

describe("deletePost", () => {
  it("reads the union payload's error member as a failure", async () => {
    mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { data: { deletePost: { __typename: "VoidMutationError", message: "Post already sent" } } };
    });

    await expect(client().deletePost("p_1")).rejects.toThrow(/Post already sent/);
  });

  it("resolves when Buffer confirms the delete", async () => {
    const calls = mockBuffer((call) => {
      if (call.query.includes("__schema")) return { data: INTROSPECTION };
      return { data: { deletePost: { __typename: "DeletePostSuccess", id: "p_1" } } };
    });

    await expect(client().deletePost("p_1")).resolves.toBeUndefined();
    expect(calls.at(-1)!.variables.input).toEqual({ id: "p_1" });
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
        fields: [
          {
            name: "edges",
            args: [],
            type: { kind: "LIST", name: null, ofType: { kind: "OBJECT", name: "OrganizationEdge", ofType: null } },
          },
        ],
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
        data: {
          account: {
            id: "a_1",
            email: "you@example.com",
            organizations: { edges: [{ node: { id: "org_7", name: "Seven" } }] },
          },
        },
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

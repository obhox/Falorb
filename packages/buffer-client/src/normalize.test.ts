import { describe, expect, it } from "vitest";
import {
  extractNodes,
  normalizeAccount,
  normalizeChannel,
  normalizeMetrics,
  normalizePost,
  normalizeTags,
  normalizeWeeklyPostingLimit,
} from "./normalize";

describe("normalizeWeeklyPostingLimit", () => {
  it("takes the number when Buffer sends one", () => {
    expect(normalizeWeeklyPostingLimit(14)).toEqual({ limit: 14, detail: null });
  });

  it("flattens the object form and keeps the object", () => {
    // The live schema's `WeeklyPostingLimit`, the shape the docs called an Int.
    expect(normalizeWeeklyPostingLimit({ limit: 7, remaining: 2 })).toEqual({
      limit: 7,
      detail: { limit: 7, remaining: 2 },
    });
  });

  it("prefers the cap over consumption when both are present", () => {
    expect(normalizeWeeklyPostingLimit({ remaining: 2, limit: 7 }).limit).toBe(7);
  });

  it("keeps an unflattenable object rather than dropping it", () => {
    expect(normalizeWeeklyPostingLimit({ perService: { twitter: 3 } })).toEqual({
      limit: null,
      detail: { perService: { twitter: 3 } },
    });
  });

  it("is null for nothing at all", () => {
    expect(normalizeWeeklyPostingLimit(null)).toEqual({ limit: null, detail: null });
  });
});

describe("normalizeChannel", () => {
  it("flattens a live channel", () => {
    const channel = normalizeChannel({
      id: "ch_1",
      name: "falorb",
      displayName: "Falorb",
      service: "twitter",
      isDisconnected: false,
      isQueuePaused: true,
      weeklyPostingLimit: { limit: 7 },
      postingSchedule: [{ days: ["mon"], times: ["09:00"] }],
      allowedActions: ["publish", { name: "schedule" }],
    });

    expect(channel).toMatchObject({
      id: "ch_1",
      displayName: "Falorb",
      isQueuePaused: true,
      weeklyPostingLimit: 7,
      weeklyPostingLimitDetail: { limit: 7 },
      allowedActions: ["publish", "schedule"],
    });
  });

  it("falls back to the queried organization when the channel doesn't name one", () => {
    expect(normalizeChannel({ id: "ch_1" }, "org_9")?.organizationId).toBe("org_9");
  });

  it("rejects a row with no id — nothing downstream can key on it", () => {
    expect(normalizeChannel({ name: "no id" })).toBeNull();
  });
});

describe("normalizePost", () => {
  it("takes the channel id from the nested channel when there's no flat field", () => {
    expect(normalizePost({ id: "p_1", channel: { id: "ch_2" } })?.channelId).toBe("ch_2");
  });

  it("falls back to the channel the query was scoped to", () => {
    expect(normalizePost({ id: "p_1" }, "ch_3")?.channelId).toBe("ch_3");
  });

  it("keeps both timestamp serializations intact for the sync job to parse", () => {
    const post = normalizePost({ id: "p_1", channelId: "ch_1", dueAt: 1700000000, sentAt: "2026-01-01T00:00:00Z" });
    expect(post?.dueAt).toBe(1700000000);
    expect(post?.sentAt).toBe("2026-01-01T00:00:00Z");
  });

  it("flattens Buffer's failure text", () => {
    expect(normalizePost({ id: "p_1", channelId: "ch_1", error: { message: "Token expired" } })?.errorMessage).toBe(
      "Token expired",
    );
  });

  it("drops a post with no resolvable channel rather than writing an orphan row", () => {
    expect(normalizePost({ id: "p_1" })).toBeNull();
  });
});

describe("tags and metrics", () => {
  it("accepts tags as strings or objects", () => {
    expect(normalizeTags(["launch", { name: "beta" }, { id: "t_3" }])).toEqual(["launch", "beta", "t_3"]);
  });

  it("keeps a metrics list", () => {
    expect(normalizeMetrics([{ type: "engagement", name: "likes", value: 4, unit: null }])).toEqual([
      { type: "engagement", name: "likes", value: 4, unit: null },
    ]);
  });

  it("turns a metrics map into a list", () => {
    expect(normalizeMetrics({ likes: 4, __typename: "Metrics" })).toEqual([
      { type: null, name: "likes", value: 4, unit: null },
    ]);
  });
});

describe("extractNodes", () => {
  it("reads a Relay connection", () => {
    expect(
      extractNodes({ edges: [{ node: { id: "p_1" } }], pageInfo: { hasNextPage: true, endCursor: "c1" } }),
    ).toEqual({ nodes: [{ id: "p_1" }], pageInfo: { hasNextPage: true, endCursor: "c1" } });
  });

  it("reads a plain list", () => {
    expect(extractNodes([{ id: "ch_1" }])).toEqual({ nodes: [{ id: "ch_1" }], pageInfo: null });
  });

  it("reads a `nodes` connection", () => {
    expect(extractNodes({ nodes: [{ id: "ch_1" }] }).nodes).toEqual([{ id: "ch_1" }]);
  });
});

describe("normalizeAccount", () => {
  it("reads organizations from either container", () => {
    expect(normalizeAccount({ id: "a_1", email: "you@example.com", organizations: [{ id: "org_1", name: "Falorb" }] }))
      .toMatchObject({ email: "you@example.com", organizations: [{ id: "org_1", name: "Falorb" }] });
    expect(
      normalizeAccount({ id: "a_1", organizations: { edges: [{ node: { id: "org_2", name: "Two" } }] } })
        ?.organizations,
    ).toEqual([{ id: "org_2", name: "Two" }]);
  });
});

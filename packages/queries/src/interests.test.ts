import { describe, expect, it } from "vitest";
import { buildContentInterests } from "./interests";

describe("buildContentInterests", () => {
  const scope = { projectIds: [1], range: { from: 0, to: 1000 } };

  it("derives topic from content_tag, falling back to the first path segment", () => {
    const { sql } = buildContentInterests(scope);
    expect(sql).toContain("props_str['content_tag']");
    expect(sql).toContain("splitByChar('/', path)[2]");
  });

  it("groups by topic and ranks by visitors", () => {
    const { sql } = buildContentInterests(scope);
    expect(sql).toContain("GROUP BY topic");
    expect(sql).toContain("ORDER BY visitors DESC, events DESC");
  });

  it("excludes the empty topic", () => {
    const { sql } = buildContentInterests(scope);
    expect(sql).toContain("WHERE topic != ''");
  });

  it("scopes by project and date range as bound parameters", () => {
    const { sql, params } = buildContentInterests(scope);
    expect(sql).toContain("has({projectIds:Array(UInt32)}, project_id)");
    expect(params.projectIds).toEqual([1]);
  });

  it("clamps the limit within its default bounds", () => {
    const { params } = buildContentInterests({ ...scope, limit: 5000 });
    expect(params.limit).toBe(200);
  });
});

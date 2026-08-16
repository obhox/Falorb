import { describe, expect, it } from "vitest";
import { FilterError, compileFilter, compileFilters, resolveBreakdown } from "./filters";

/**
 * These tests are the guard on the query layer's security boundary. The
 * property that matters is not "the SQL looks right" but "no user-supplied
 * value ever appears in the SQL string".
 */
describe("compileFilter — injection safety", () => {
  it("binds values as parameters instead of interpolating them", () => {
    const { sql, params } = compileFilter({ field: "path", op: "eq", value: "/pricing" });
    expect(sql).not.toContain("/pricing");
    expect(Object.values(params)).toContain("/pricing");
  });

  it("keeps a SQL injection attempt entirely out of the statement", () => {
    const payload = "'; DROP TABLE events; --";
    const { sql, params } = compileFilter({ field: "path", op: "eq", value: payload });
    expect(sql).not.toContain("DROP");
    expect(sql).not.toContain(payload);
    expect(Object.values(params)).toContain(payload);
  });

  it("rejects an unknown field rather than interpolating it", () => {
    expect(() =>
      compileFilter({ field: "path; DROP TABLE events", op: "eq", value: "x" }),
    ).toThrow(FilterError);
    expect(() => compileFilter({ field: "__proto__", op: "eq", value: "x" })).toThrow(FilterError);
  });

  it("binds a custom property name as a parameter too", () => {
    const evil = "a'])--";
    const { sql, params } = compileFilter({ field: `prop:${evil}`, op: "eq", value: "v" });
    expect(sql).not.toContain(evil);
    expect(Object.values(params)).toContain(evil);
  });

  it("does not let a wildcard leak into a contains match", () => {
    // position() takes the needle as data, so a literal % stays literal —
    // unlike LIKE, where it would silently become a wildcard.
    const { sql, params } = compileFilter({ field: "path", op: "contains", value: "100%" });
    expect(sql).toContain("position(");
    expect(sql).not.toContain("LIKE");
    expect(Object.values(params)).toContain("100%");
  });

  it("gives each condition a distinct parameter name", () => {
    const { params } = compileFilters([
      { field: "path", op: "eq", value: "/a" },
      { field: "path", op: "eq", value: "/b" },
    ]);
    expect(Object.keys(params)).toHaveLength(2);
    expect(new Set(Object.values(params))).toEqual(new Set(["/a", "/b"]));
  });

  it("namespaces parameters by prefix so separate filters cannot collide", () => {
    const a = compileFilter({ field: "path", op: "eq", value: "/a" }, "s0f");
    const b = compileFilter({ field: "path", op: "eq", value: "/b" }, "s1f");
    expect(Object.keys(a.params)[0]).not.toBe(Object.keys(b.params)[0]);
  });
});

describe("compileFilter — semantics", () => {
  it("combines AND groups", () => {
    const { sql } = compileFilter({
      and: [
        { field: "country", op: "eq", value: "NG" },
        { field: "device_type", op: "eq", value: "mobile" },
      ],
    });
    expect(sql).toContain(" AND ");
  });

  it("combines OR groups", () => {
    const { sql } = compileFilter({
      or: [
        { field: "channel", op: "eq", value: "organic_search" },
        { field: "channel", op: "eq", value: "referral" },
      ],
    });
    expect(sql).toContain(" OR ");
  });

  it("negates with NOT", () => {
    const { sql } = compileFilter({ not: { field: "path", op: "eq", value: "/" } });
    expect(sql).toMatch(/^NOT \(/);
  });

  it("treats an empty IN list as matching nothing", () => {
    expect(compileFilter({ field: "path", op: "in", value: [] }).sql).toBe("0");
  });

  it("treats an empty NOT IN list as matching everything", () => {
    expect(compileFilter({ field: "path", op: "not_in", value: [] }).sql).toBe("1");
  });

  it("caps IN list size", () => {
    const huge = Array.from({ length: 1001 }, (_, i) => `p${i}`);
    expect(() => compileFilter({ field: "path", op: "in", value: huge })).toThrow(FilterError);
  });

  it("uses numeric comparison for numeric fields", () => {
    const { sql, params } = compileFilter({ field: "duration_ms", op: "gte", value: 5000 });
    expect(sql).toContain(">=");
    expect(Object.values(params)).toContain(5000);
  });

  it("rejects a non-numeric value for a numeric field", () => {
    expect(() => compileFilter({ field: "duration_ms", op: "gt", value: "abc" })).toThrow(
      FilterError,
    );
  });

  it("handles is_set / is_not_set without a value", () => {
    expect(compileFilter({ field: "utm_campaign", op: "is_set" }).sql).toContain("!= ''");
    expect(compileFilter({ field: "duration_ms", op: "is_not_set" }).sql).toContain("= 0");
  });

  it("requires a value for operators that need one", () => {
    expect(() => compileFilter({ field: "path", op: "eq" })).toThrow(FilterError);
  });

  it("compiles an empty filter list to a always-true predicate", () => {
    expect(compileFilters([]).sql).toBe("1");
  });
});

describe("resolveBreakdown", () => {
  it("resolves a known dimension", () => {
    expect(resolveBreakdown("channel").expr).toBe("channel");
  });

  it("binds a custom property breakdown as a parameter", () => {
    const { expr, params } = resolveBreakdown("prop:plan");
    expect(expr).toContain("props_str[");
    expect(Object.values(params)).toContain("plan");
  });

  it("rejects an unknown dimension", () => {
    expect(() => resolveBreakdown("evil; DROP TABLE events")).toThrow(FilterError);
  });
});

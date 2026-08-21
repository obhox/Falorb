"use client";

import { useState } from "react";
import { Button, Icon, Input, Select } from "@falorb/ui";
import type { Condition, Filter, FilterOperator } from "@falorb/queries";

/**
 * Builds a `Filter[]` — groups of conditions ANDed together, each group's own
 * conditions ORed within it ("match ALL of these groups; within a group,
 * match ANY of these"). This is deliberately not the full and/or/not tree
 * `Filter` supports: every segment-builder UI worth copying (Mixpanel,
 * Amplitude) settles on this two-level shape because it is the one ordinary
 * users can read back correctly, and every condition can still be negated at
 * the operator level (`neq`, `not_contains`, `is_not_set`, ...).
 *
 * Field values are always sent as strings — `compileFilter`
 * (`@falorb/queries`) coerces per the field's real type server-side, so this
 * component never needs to know which fields are numeric.
 */

const NUMERIC_FIELDS = new Set(["screen_w", "screen_h", "revenue", "duration_ms", "is_bot"]);

const STRING_OPS: { value: FilterOperator; label: string }[] = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "doesn't contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

const NUMBER_OPS: { value: FilterOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

const CUSTOM_TEXT = "__custom_text__";
const CUSTOM_NUMBER = "__custom_number__";

const uid = () => crypto.randomUUID();

interface ConditionDraft {
  key: string;
  field: string;
  propName: string;
  op: FilterOperator;
  value: string;
}

interface GroupDraft {
  key: string;
  conditions: ConditionDraft[];
}

function newCondition(defaultField: string): ConditionDraft {
  return { key: uid(), field: defaultField, propName: "", op: "eq", value: "" };
}

function fieldName(c: ConditionDraft): string {
  if (c.field === CUSTOM_TEXT) return `prop:${c.propName.trim()}`;
  if (c.field === CUSTOM_NUMBER) return `nprop:${c.propName.trim()}`;
  return c.field;
}

function isNumericField(c: ConditionDraft): boolean {
  if (c.field === CUSTOM_NUMBER) return true;
  if (c.field === CUSTOM_TEXT) return false;
  return NUMERIC_FIELDS.has(c.field);
}

function needsValue(op: FilterOperator): boolean {
  return op !== "is_set" && op !== "is_not_set";
}

function conditionValid(c: ConditionDraft): boolean {
  const field = fieldName(c);
  if (!field || field === "prop:" || field === "nprop:") return false;
  if (needsValue(c.op) && !c.value.trim()) return false;
  return true;
}

export function groupsToFilters(groups: GroupDraft[]): Filter[] {
  const filters: Filter[] = [];
  for (const g of groups) {
    const valid = g.conditions.filter(conditionValid);
    if (!valid.length) continue;
    const conditions: Condition[] = valid.map((c) => ({
      field: fieldName(c),
      op: c.op,
      ...(needsValue(c.op) ? { value: c.value.trim() } : {}),
    }));
    filters.push(conditions.length > 1 ? { or: conditions } : conditions[0]!);
  }
  return filters;
}

export function ConditionTreeBuilder({
  fields,
  groups,
  onChange,
}: {
  fields: string[];
  groups: GroupDraft[];
  onChange: (groups: GroupDraft[]) => void;
}) {
  const fieldOptions = ["Custom text property", "Custom number property", ...fields];

  function fieldLabel(f: string): string {
    if (f === CUSTOM_TEXT) return "Custom text property";
    if (f === CUSTOM_NUMBER) return "Custom number property";
    return f;
  }
  function fieldFromLabel(label: string): string {
    if (label === "Custom text property") return CUSTOM_TEXT;
    if (label === "Custom number property") return CUSTOM_NUMBER;
    return label;
  }

  function updateGroup(key: string, mutate: (g: GroupDraft) => GroupDraft) {
    onChange(groups.map((g) => (g.key === key ? mutate(g) : g)));
  }

  function updateCondition(groupKey: string, condKey: string, patch: Partial<ConditionDraft>) {
    updateGroup(groupKey, (g) => ({
      ...g,
      conditions: g.conditions.map((c) => (c.key === condKey ? { ...c, ...patch } : c)),
    }));
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {groups.map((group, gi) => (
        <div key={group.key} style={{ display: "grid", gap: 6 }}>
          {gi > 0 && (
            <div style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", fontWeight: "var(--wt-medium)" }}>
              AND
            </div>
          )}
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 10,
              borderRadius: "var(--radius-2)",
              background: "var(--surface-inset)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {group.conditions.map((c, ci) => {
              const numeric = isNumericField(c);
              const ops = numeric ? NUMBER_OPS : STRING_OPS;
              return (
                <div key={c.key} style={{ display: "grid", gap: 6 }}>
                  {ci > 0 && (
                    <div style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>OR</div>
                  )}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <Select
                      size="sm"
                      value={fieldLabel(c.field)}
                      options={fieldOptions}
                      onChange={(label: string) =>
                        updateCondition(group.key, c.key, { field: fieldFromLabel(label) })
                      }
                    />
                    {(c.field === CUSTOM_TEXT || c.field === CUSTOM_NUMBER) && (
                      <Input
                        size="sm"
                        value={c.propName}
                        placeholder="property name"
                        style={{ width: 140 }}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateCondition(group.key, c.key, { propName: e.target.value })
                        }
                      />
                    )}
                    <Select
                      size="sm"
                      value={ops.find((o) => o.value === c.op)?.label ?? ops[0]!.label}
                      options={ops.map((o) => o.label)}
                      onChange={(label: string) => {
                        const match = ops.find((o) => o.label === label);
                        if (match) updateCondition(group.key, c.key, { op: match.value });
                      }}
                    />
                    {needsValue(c.op) && (
                      <Input
                        size="sm"
                        value={c.value}
                        placeholder="value"
                        style={{ width: 140 }}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateCondition(group.key, c.key, { value: e.target.value })
                        }
                      />
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        updateGroup(group.key, (g) => ({
                          ...g,
                          conditions: g.conditions.filter((cond) => cond.key !== c.key),
                        }))
                      }
                    >
                      <Icon name="x" size={13} />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button
              size="sm"
              onClick={() =>
                updateGroup(group.key, (g) => ({
                  ...g,
                  conditions: [...g.conditions, newCondition(fields[0] ?? CUSTOM_TEXT)],
                }))
              }
              style={{ justifySelf: "start" }}
            >
              + Or condition
            </Button>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        onClick={() =>
          onChange([...groups, { key: uid(), conditions: [newCondition(fields[0] ?? CUSTOM_TEXT)] }])
        }
        style={{ justifySelf: "start" }}
      >
        + And group
      </Button>
    </div>
  );
}

export function newEmptyGroups(defaultField: string): GroupDraft[] {
  return [{ key: uid(), conditions: [newCondition(defaultField)] }];
}

export type { GroupDraft, ConditionDraft };

"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  IconButton,
  Input,
  SegmentedControl,
  Switch,
} from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { createGoal, deleteGoal, toggleGoal } from "@/server/actions/goals";
import { useAction } from "@/lib/use-action";
import { money, num, pct } from "@/lib/format";

export interface GoalView {
  id: string;
  name: string;
  kind: string;
  matcher: string;
  active: boolean;
  currency: string;
  visitors: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  revenueIsAssumed: boolean;
}

/**
 * Goals and their conversion figures.
 *
 * Revenue that came from a goal's assumed per-conversion value is labelled as
 * assumed. Presenting an estimate beside measured revenue without saying which
 * is which is the kind of quiet inaccuracy that gets into a board deck.
 */
export function GoalsPanel({ slug, goals }: { slug: string; goals: GoalView[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"event" | "path">("event");
  const [matcher, setMatcher] = useState("");
  const [value, setValue] = useState("");

  async function submit() {
    const data = new FormData();
    data.set("name", name);
    data.set("kind", kind);
    data.set("matcher", matcher);
    data.set("value", value);

    const result = await run(() => createGoal(slug, data), { success: "Goal created" });
    if (!result?.ok) return;

    setOpen(false);
    setName("");
    setMatcher("");
    setValue("");
  }

  async function remove(goalId: string) {
    await run(() => deleteGoal(slug, goalId));
  }

  async function setActive(goalId: string, active: boolean) {
    await run(() => toggleGoal(slug, goalId, active), {
      success: active ? "Goal enabled" : "Goal paused",
    });
  }

  return (
    <>
      <Card
        title="Goals"
        subtitle="Conversions counted against the selected range"
        action={
          <Button
            size="sm"
            variant="primary"
            iconLeft={<Icon name="plus" size={13} />}
            onClick={() => setOpen(true)}
          >
            Add goal
          </Button>
        }
      >
        {goals.length === 0 ? (
          <Empty
            icon="target"
            title="No goals defined"
            body="A goal names an event or a page that counts as a conversion, so its rate can be tracked without rebuilding a funnel each time."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                Add the first goal
              </Button>
            }
          />
        ) : (
          <div className="falorb-scroll-x">
          <div style={{ display: "grid", gap: 1 }}>
            <div style={{ ...headerRow }}>
              <span>Goal</span>
              <span style={{ textAlign: "right" }}>Conversions</span>
              <span style={{ textAlign: "right" }}>People</span>
              <span style={{ textAlign: "right" }}>Rate</span>
              <span style={{ textAlign: "right" }}>Revenue</span>
              <span />
              <span />
            </div>

            {goals.map((goal) => (
              <div key={goal.id} style={{ ...bodyRow, opacity: goal.active ? 1 : 0.5 }}>
                <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: "var(--size-body-sm)",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {goal.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--size-micro)",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {goal.kind}: {goal.matcher}
                  </span>
                </span>
                <span style={figure}>{num(goal.conversions)}</span>
                <span style={figure}>{num(goal.visitors)}</span>
                <span style={figure}>{pct(goal.conversionRate)}</span>
                <span
                  style={{
                    ...figure,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 6,
                  }}
                >
                  {goal.revenue > 0 ? money(goal.revenue, goal.currency) : "—"}
                  {goal.revenueIsAssumed && <Badge tone="warn">assumed</Badge>}
                </span>
                <Switch
                  size="sm"
                  checked={goal.active}
                  onChange={(checked: boolean) => setActive(goal.id, checked)}
                />
                <IconButton
                  size="sm"
                  label={`Remove ${goal.name}`}
                  icon={<Icon name="trash-2" size={13} />}
                  disabled={pending}
                  onClick={() => remove(goal.id)}
                />
              </div>
            ))}
          </div>
          </div>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add goal"
        subtitle="What counts as a conversion on this property"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? "Creating" : "Create goal"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Trial started"
          />

          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: "var(--size-label)",
                color: "var(--text-secondary)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              Match on
            </span>
            <SegmentedControl
              size="sm"
              options={["Event", "Page"]}
              value={kind === "event" ? "Event" : "Page"}
              onChange={(label: string) => setKind(label === "Page" ? "path" : "event")}
            />
          </div>

          <Input
            label={kind === "event" ? "Event name" : "Path"}
            mono
            value={matcher}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMatcher(e.target.value)}
            placeholder={kind === "event" ? "signup" : "/welcome*"}
            hint={
              kind === "event"
                ? "Exactly what the tracker sends to track()."
                : "A trailing * matches everything under that prefix."
            }
          />

          <Input
            label="Value per conversion"
            mono
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            placeholder="0"
            hint="Used only when the event carries no revenue of its own. Leave blank to report measured revenue only."
          />

        </div>
      </Dialog>
    </>
  );
}

const headerRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1.6fr) 100px 90px 80px 130px 44px 34px",
  gap: 12,
  height: 30,
  alignItems: "center",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--size-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-label)",
  color: "var(--text-muted)",
  fontWeight: "var(--wt-medium)",
};

const bodyRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1.6fr) 100px 90px 80px 130px 44px 34px",
  gap: 12,
  minHeight: "var(--row-height)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-body-sm)",
  color: "var(--text-primary)",
  textAlign: "right",
};

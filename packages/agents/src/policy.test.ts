import { describe, expect, it } from "vitest";
import type { MemberRole } from "@falorb/db";
import { canDecideApproval, canGrantAgentRole, decide } from "./policy";
import type { ToolDefinition } from "./types";

const tool = (
  over: Partial<Pick<ToolDefinition, "name" | "capability" | "effect">> = {},
): Pick<ToolDefinition, "name" | "capability" | "effect"> => ({
  name: "crm_create_contact",
  capability: "actOnIntegrations",
  effect: "external",
  ...over,
});

const agent = (
  over: Partial<{ role: MemberRole; autonomy: string; autoApproveTools: string[] }> = {},
) => ({
  role: "member" as MemberRole,
  autonomy: "assisted",
  autoApproveTools: [] as string[],
  ...over,
});

describe("decide", () => {
  it("denies anything the agent's role cannot do, whatever its autonomy", () => {
    const d = decide(agent({ role: "viewer", autonomy: "autonomous", autoApproveTools: ["*"] }), tool());
    expect(d.kind).toBe("deny");
  });

  it("lets any agent read", () => {
    const read = tool({ name: "get_stats", capability: "read", effect: "read" });
    for (const autonomy of ["observer", "assisted", "autonomous"]) {
      expect(decide(agent({ role: "viewer", autonomy }), read).kind).toBe("allow");
    }
  });

  it("denies an observer every write, rather than queuing it", () => {
    const internal = tool({ name: "create_task", capability: "manageTasks", effect: "internal" });
    expect(decide(agent({ autonomy: "observer" }), internal).kind).toBe("deny");
  });

  it("queues an assisted agent's internal write for approval", () => {
    const internal = tool({ name: "create_task", capability: "manageTasks", effect: "internal" });
    expect(decide(agent({ autonomy: "assisted" }), internal).kind).toBe("approval");
  });

  it("lets an autonomous agent write inside Falorb but not outside it", () => {
    const internal = tool({ name: "create_task", capability: "manageTasks", effect: "internal" });
    expect(decide(agent({ autonomy: "autonomous" }), internal).kind).toBe("allow");
    expect(decide(agent({ autonomy: "autonomous" }), tool()).kind).toBe("approval");
  });

  it("honours a per-tool waiver, and only for the named tool", () => {
    const a = agent({ autonomy: "autonomous", autoApproveTools: ["crm_create_contact"] });
    expect(decide(a, tool()).kind).toBe("allow");
    expect(decide(a, tool({ name: "support_resolve_escalation" })).kind).toBe("approval");
  });

  it("honours a blanket waiver", () => {
    const a = agent({ autonomy: "autonomous", autoApproveTools: ["*"] });
    expect(decide(a, tool()).kind).toBe("allow");
  });

  it("still denies a waived tool the role forbids", () => {
    const a = agent({ role: "viewer", autonomy: "autonomous", autoApproveTools: ["*"] });
    expect(decide(a, tool()).kind).toBe("deny");
  });

  it("treats an unknown autonomy value as observer", () => {
    const internal = tool({ name: "create_task", capability: "manageTasks", effect: "internal" });
    expect(decide(agent({ autonomy: "yolo" }), internal).kind).toBe("deny");
  });
});

describe("canDecideApproval", () => {
  it("refuses a reviewer who could not perform the action themselves", () => {
    expect(canDecideApproval("viewer", "actOnIntegrations")).toBe(false);
    expect(canDecideApproval("member", "actOnIntegrations")).toBe(true);
    expect(canDecideApproval("member", "manageIntegrations")).toBe(false);
    expect(canDecideApproval("admin", "manageIntegrations")).toBe(true);
  });

  it("refuses an unknown capability rather than failing open", () => {
    expect(canDecideApproval("owner", "notARealCapability")).toBe(false);
  });
});

describe("canGrantAgentRole", () => {
  it("refuses to hand an agent more authority than the granter has", () => {
    expect(canGrantAgentRole("admin", "owner")).toBe(false);
    expect(canGrantAgentRole("admin", "admin")).toBe(true);
    expect(canGrantAgentRole("owner", "owner")).toBe(true);
    expect(canGrantAgentRole("member", "viewer")).toBe(false);
  });
});

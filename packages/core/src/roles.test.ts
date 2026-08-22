import { describe, expect, it } from "vitest";
import { atLeast, can, capForRole, rankOf, scopesForRole } from "./roles";

/**
 * The role model is now the thing standing between a bearer credential and an
 * owner's authority, so the properties below are the ones worth pinning: they
 * are what the API and the MCP server both rely on, and a regression in any of
 * them reopens the escalation that motivated `api_keys.role`.
 */

describe("rankOf", () => {
  it("orders the roles strictly", () => {
    expect(rankOf("viewer")).toBeLessThan(rankOf("member"));
    expect(rankOf("member")).toBeLessThan(rankOf("admin"));
    expect(rankOf("admin")).toBeLessThan(rankOf("owner"));
  });

  it("treats anything it does not recognise as the least privileged role", () => {
    // A role written by an older or newer schema, or the "api_key" placeholder
    // this codebase used to store, must never resolve to more authority than
    // the caller can demonstrate.
    for (const unknown of ["", "api_key", "superuser", "OWNER"]) {
      expect(rankOf(unknown)).toBe(rankOf("viewer"));
    }
  });
});

describe("capForRole", () => {
  it("grants what was asked for when the issuer holds it", () => {
    expect(capForRole("owner", "admin")).toBe("admin");
    expect(capForRole("admin", "member")).toBe("member");
    expect(capForRole("member", "member")).toBe("member");
  });

  it("never grants above the issuer's own role", () => {
    // The escalation this exists to stop: mint a credential more powerful than
    // yourself, then present it. The key would also outlive your membership.
    expect(capForRole("admin", "owner")).toBe("admin");
    expect(capForRole("member", "owner")).toBe("member");
    expect(capForRole("viewer", "admin")).toBe("viewer");
  });

  it("clamps an unrecognised request down rather than through", () => {
    expect(capForRole("owner", "superuser")).toBe("viewer");
    expect(capForRole("viewer", "superuser")).toBe("viewer");
  });

  it("clamps an unrecognised issuer to viewer", () => {
    expect(capForRole("api_key", "owner")).toBe("viewer");
  });
});

describe("scopesForRole", () => {
  it("gives a viewer read and nothing else", () => {
    // This is the case the API got wrong: every signed-in caller was handed
    // read, write and admin regardless of role.
    expect(scopesForRole("viewer")).toEqual(["read"]);
  });

  it("adds write at member and admin at admin", () => {
    expect(scopesForRole("member")).toEqual(["read", "write"]);
    expect(scopesForRole("admin")).toEqual(["read", "write", "admin"]);
    expect(scopesForRole("owner")).toEqual(["read", "write", "admin"]);
  });

  it("gives an unrecognised role read only", () => {
    expect(scopesForRole("nonsense")).toEqual(["read"]);
  });

  it("agrees with the capabilities it is derived from", () => {
    for (const role of ["viewer", "member", "admin", "owner"]) {
      const scopes = scopesForRole(role);
      expect(scopes.includes("write")).toBe(can.writeAnalysis(role));
      expect(scopes.includes("admin")).toBe(can.manageProject(role));
    }
  });
});

describe("can", () => {
  it("keeps role assignment and property archival owner-only", () => {
    // The two capabilities a leaked write key must never reach, whatever role
    // it carries short of owner.
    for (const role of ["viewer", "member", "admin"]) {
      expect(can.assignRole(role)).toBe(false);
      expect(can.archiveProject(role)).toBe(false);
    }
    expect(can.assignRole("owner")).toBe(true);
    expect(can.archiveProject("owner")).toBe(true);
  });

  it("is a strict hierarchy — a greater role can do everything a lesser one can", () => {
    // `atLeast` is only sound as rank comparison if this holds; a capability
    // model with exceptions cannot be expressed as a rank and pretending
    // otherwise produces holes.
    const ordered = ["viewer", "member", "admin", "owner"];
    for (const capability of Object.values(can)) {
      let seenTrue = false;
      for (const role of ordered) {
        const allowed = capability(role);
        if (allowed) seenTrue = true;
        else expect(seenTrue).toBe(false);
      }
    }
  });

  it("matches atLeast for the tiers the guards depend on", () => {
    expect(can.manageTeam("admin")).toBe(atLeast("admin", "admin"));
    expect(can.manageTeam("member")).toBe(false);
  });
});

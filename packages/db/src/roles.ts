/**
 * What each role may do.
 *
 * The role model lived as a two-element `Set` inside the API's team routes,
 * which was enough while the API was the only thing performing writes. The
 * dashboard now writes too — project settings, goals, alerts, share links — and
 * a second, separately-invented interpretation of "admin" is how one surface
 * quietly permits what the other forbids. So the rules live here, once, and
 * both apps import them.
 *
 * The hierarchy is strict: every capability of a lesser role belongs to a
 * greater one. That is worth stating because it makes `atLeast` sound — a
 * capability model with exceptions cannot be expressed as a rank comparison,
 * and pretending otherwise produces holes.
 *
 *   viewer  read everything in the workspace
 *   member  + create and edit analysis objects: goals, alerts, saved views
 *   admin   + project settings, public share links, managing the team
 *   owner   + assigning roles, removing members, archiving a property
 *
 * The split between member and admin is the one that matters in practice: a
 * viewer or member cannot change what is collected, who may see it, or who is
 * in the workspace.
 */

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Greater rank means strictly more capability. */
const RANK: Record<MemberRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * An unrecognised role is treated as the least privileged one.
 *
 * Roles arrive from a database column, and a value written by an older or newer
 * version of the schema must not fail open. Defaulting to `viewer` means the
 * worst outcome is someone temporarily unable to edit, rather than a stranger
 * able to.
 */
export function rankOf(role: string): number {
  return RANK[role as MemberRole] ?? RANK.viewer;
}

export function atLeast(role: string, required: MemberRole): boolean {
  return rankOf(role) >= RANK[required];
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Everything, including roles, removing people and archiving a property.",
  admin: "Property settings, public links and the team. Cannot assign roles.",
  member: "Create and edit goals, alerts and saved views. Cannot change settings.",
  viewer: "Read everything. Changes nothing.",
};

/** Named capabilities, so call sites read as intent rather than as rank maths. */
export const can = {
  /** Everyone in the workspace. */
  read: (role: string) => atLeast(role, "viewer"),
  /** Goals, alerts, saved views — analysis objects, not configuration. */
  writeAnalysis: (role: string) => atLeast(role, "member"),
  /** Domains, retention, consent, cookieless, timezone. */
  manageProject: (role: string) => atLeast(role, "admin"),
  /** Issue and revoke public share links. */
  share: (role: string) => atLeast(role, "admin"),
  /** Invite, revoke invitations, remove members. */
  manageTeam: (role: string) => atLeast(role, "admin"),
  /** Change someone's role, including promoting another owner. */
  assignRole: (role: string) => atLeast(role, "owner"),
  /** Archive a property, which hides its data from every screen. */
  archiveProject: (role: string) => atLeast(role, "owner"),
  /** Push a signal, create/update a CRM contact, resolve a support case — real actions on a connected external system, not just reading its mirror. */
  actOnIntegrations: (role: string) => atLeast(role, "member"),
  /** Store, test, or revoke the credential that lets Falorb act as another product's tenant — same trust tier as issuing an API key. */
  manageIntegrations: (role: string) => atLeast(role, "admin"),
  /** Add/edit a CRM contact profile, create or move a deal — Falorb's own CRM data, normal sales work rather than admin/credential territory. */
  manageCrm: (role: string) => atLeast(role, "member"),
  /** Generate a UGC video (spends AI credits) and queue it for posting — normal marketing work, same tier as `manageCrm`/`writeAnalysis` rather than admin/credential territory. */
  manageUgcVideos: (role: string) => atLeast(role, "member"),
} satisfies Record<string, (role: string) => boolean>;

/**
 * Roles that may be handed out.
 *
 * `owner` is assignable — a workspace with exactly one owner is one lost
 * account away from being unadministrable — but only by an existing owner,
 * which `can.assignRole` enforces.
 */
export const ASSIGNABLE_ROLES: MemberRole[] = ["admin", "member", "viewer", "owner"];

/** Roles an invitation may carry. An invite cannot mint an owner. */
export const INVITABLE_ROLES: MemberRole[] = ["admin", "member", "viewer"];

export function isMemberRole(value: string): value is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value);
}

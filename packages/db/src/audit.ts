import type { Database } from "./index";
import * as schema from "./schema/index";

/**
 * Audit logging for privileged actions.
 *
 * Answers "who changed this, and when" after the fact. The actions worth
 * recording are the ones that are hard to reconstruct from state alone: a
 * revoked key looks identical whether it was revoked deliberately or by
 * someone who should not have had access, and a deleted person leaves nothing
 * behind by design.
 *
 * Writes are fire-and-forget. An audit failure must never block the action it
 * describes — refusing to revoke a compromised key because the log was
 * unavailable would be strictly worse than losing the log entry.
 */

export const AUDIT_ACTIONS = {
  projectCreated: "project.created",
  projectUpdated: "project.updated",
  projectArchived: "project.archived",
  apiKeyCreated: "api_key.created",
  apiKeyRevoked: "api_key.revoked",
  memberInvited: "member.invited",
  memberJoined: "member.joined",
  memberRemoved: "member.removed",
  memberRoleChanged: "member.role_changed",
  personMerged: "person.merged",
  personUnmerged: "person.unmerged",
  personErased: "person.erased",
  personExported: "person.exported",
  dataRetentionChanged: "retention.changed",
  webhookCreated: "webhook.created",
  webhookDeleted: "webhook.deleted",
  alertCreated: "alert.created",
  alertDeleted: "alert.deleted",
  integrationConnected: "integration.connected",
  integrationRevoked: "integration.revoked",
  crmSignalPushed: "crm.signal_pushed",
  crmContactCreated: "crm.contact_created",
  crmContactUpdated: "crm.contact_updated",
  crmProfileCreated: "crm.profile_created",
  crmProfileUpdated: "crm.profile_updated",
  crmDealCreated: "crm.deal_created",
  crmDealUpdated: "crm.deal_updated",
  supportEscalationResolved: "support.escalation_resolved",
  socialPostCreated: "social.post_created",
  contentDraftPublished: "content.draft_published",
  emailAccountCreated: "email_account.created",
  emailAccountArchived: "email_account.archived",
  emailSent: "email.sent",
  agentCreated: "agent.created",
  agentUpdated: "agent.updated",
  agentDeleted: "agent.deleted",
  agentRoleChanged: "agent.role_changed",
  agentAutonomyChanged: "agent.autonomy_changed",
  agentRunStarted: "agent.run_started",
  agentActionApproved: "agent.action_approved",
  agentActionRejected: "agent.action_rejected",
  agentActionExecuted: "agent.action_executed",
  taskAssigned: "task.assigned",
  taskCompleted: "task.completed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  organizationId: string;
  /** Null for actions taken by a worker, an API key, or an agent. */
  actorId?: string | null;
  /**
   * Set instead of `actorId` when an AI employee took the action.
   *
   * Agent actions land in the same log as human ones deliberately. A
   * separate "agent activity" table would mean answering "who changed this
   * deal" required reading two places and merging them by timestamp — and
   * the whole point of the design is that the two kinds of colleague are
   * accountable in the same way.
   */
  actorAgentId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export function audit(db: Database, entry: AuditEntry): void {
  void db
    .insert(schema.auditLog)
    .values({
      organizationId: entry.organizationId,
      actorId: entry.actorId ?? null,
      actorAgentId: entry.actorAgentId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: redactSecrets(entry.metadata ?? {}),
    })
    .catch((error) => console.error("[audit] write failed:", String(error)));
}

/**
 * Strip anything secret-shaped before it is written.
 *
 * The audit log is broadly readable within an organization and is not itself
 * a secure store; a plaintext API key ending up here would turn a record of a
 * credential's creation into a copy of the credential.
 */
const SECRET_KEYS = /^(key|secret|password|token|authorization|hash|credential)/i;

function redactSecrets(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}

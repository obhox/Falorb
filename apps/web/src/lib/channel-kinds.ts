/**
 * The delivery channel types an alert can use.
 *
 * A plain module, not the action file. A `"use server"` file may only export
 * async functions — every other export becomes a client reference, and Next
 * refuses the module outright with "a use server file can only export async
 * functions, found object". That failure happens at module evaluation, so it
 * takes down the whole route rather than the one export, which is how a
 * constant array broke the entire alerts page.
 *
 * Types are safe to export from an action file because they are erased before
 * the compiler ever sees them. Values are not.
 */

export const CHANNEL_KINDS = ["slack", "webhook", "email"] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const CHANNEL_LABELS: Record<ChannelKind, string> = {
  slack: "Slack",
  webhook: "Webhook",
  email: "Email",
};

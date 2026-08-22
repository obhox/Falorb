---
name: linki-safe-send
description: Send one outreach message (email, LinkedIn message, or InMail) to one existing Linki CRM contact, with a suppression check and a rendered preview immediately before the irreversible send call. General-purpose safe-send building block — use it any time an agent is about to send through Linki, not only for cold outreach.
---

## When to use

Any time an agent has a specific `contact_id` in Linki and a message to deliver to them —
regardless of what produced that contact or that message. This skill is the single place
the actual send call happens; other skills (like `cold-outreach-campaign`) should call
into this one rather than calling `inbox_send_email` directly, so the safety checks can't
be accidentally skipped by a shortcut elsewhere.

## Preconditions

- The contact already exists in Linki (`contact_id`) with an email address that is either
  independently verified (e.g. by `contact-email-discovery`) or otherwise known-good.
- You have message content ready — either a `template_id`, or literal subject/body.

## Steps

1. **Suppression check first, always.**
   `suppression_manage({ action: "check", kind: "email", value: <contact's email> })`.
   If suppressed, stop — do not send, and do not look for a workaround (a different
   sender, a slightly different address). Suppression in this system is permanent.

2. **Pick a healthy sender.**
   `sender_accounts_list` to see configured senders, cross-checked against
   `email_health` for ramp-up state and deliverability signals. Don't send from an account
   that's still ramping or flagged unhealthy — a send from a bad sender damages domain
   reputation for every future send, not just this one.

3. **Render and read the actual preview before sending.**
   `outreach_preview` with `step_type: "email"` (or `"message"` / `"sales_inmail"` for
   LinkedIn), the real `contact_id`, and the real subject/body or `template_id`. This
   applies the same variable substitution, signature, and delivery-mode rules as the live
   send — read the rendered output. If it contains a placeholder that didn't resolve, a
   fact that isn't grounded in what you actually know about this contact, or reads as
   generic/spammy, fix the input and preview again. Never send on the strength of the
   *unrendered* template.

4. **Send.**
   `inbox_send_email` with `confirm: true`, the chosen `email_account_id`, and the exact
   `to`/`subject`/`body` that the preview validated. This call is irreversible — an actual
   email leaves the sending domain.

5. **Record it.** Add the contact to a "contacted"/"sent" list via `list_members_update`
   (or rely on Linki's own sent-message history via `contact_get`) so nothing else in the
   workspace re-sends to this person. Log what was sent and why in whatever the calling
   skill's run report is — a send with no audit trail is not something a human can review
   after the fact, which matters most precisely when nothing gates the send beforehand.

## Guardrails

- One send per `contact_id` per campaign, ever. Check `contact_get` first if there's any
  chance this contact has already been reached (e.g. a resumed or retried run).
- Respect any per-run send cap the calling skill sets — this skill doesn't invent a
  volume limit of its own, but it also never sends past whatever cap it's told.
- If `suppression_manage` or `sender_accounts_list`/`email_health` calls fail or return
  ambiguous data, treat that as "don't send," not "send anyway" — a failed safety check is
  not the same as a passed one.

## What NOT to do

- Don't call `inbox_send_email` directly from another skill, skipping steps 1–3. That's
  what this skill exists to prevent.
- Don't retry a suppressed contact through a different sender account or a lightly-edited
  address to "get around" the suppression. If the address is genuinely wrong, that's a
  `contact-email-discovery` problem to resolve, not a reason to send anyway.

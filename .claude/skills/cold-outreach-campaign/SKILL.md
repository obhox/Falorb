---
name: cold-outreach-campaign
description: EXAMPLE end-to-end pipeline — given a natural-language description of a target company/person type and a message brief, find matching companies, find and verify one contact at each, and autonomously send a grounded cold email through Linki. This is one composition of company-research + contact-email-discovery + linki-safe-send; see .claude/skills/README.md for the general pattern and other ways to combine the atomic skills.
---

## When to use

The user (or a scheduled agent) wants to go from "companies that look like X" to "sent
emails to real, verified people there" in one run, with no human approval gate on the
individual sends. Because this pipeline sends without a human in the loop, it carries
real deliverability and compliance weight — read the whole skill, not just the steps,
before running it.

## Inputs

- `targetDescription` — natural-language criterion for the companies/people to find (fed
  to `company-research`).
- `contactRole` — the role to target at each company if a specific name isn't already
  known (e.g. "founder", "head of growth").
- `messageBrief` — what the email should say and why *this* recipient specifically, not
  generic copy. Every sent message must reference something real and grounded — the
  company's own site content, a specific fact from `company-research`'s `groundingFact`,
  never an invented detail.
- `maxSends` — hard cap on sends for this run (default: 10 if not specified). This is a
  safety valve independent of verification — even a fully verified target list should not
  be blasted in one run.

## Steps

1. Run `company-research` with `targetDescription` (and `contactRole` if given) to get a
   deduped list of `{ companyName, domain, contactName, contactTitle, contactProfileUrl,
   groundingFact }`.

2. For each result, in order, up to `maxSends` successful sends:
   a. Run `contact-email-discovery` with the contact's name and the company domain.
      If it returns `verified: false`, **skip this target** — log the reason, do not
      fall back to sending an unverified guess.
   b. Draft the message from `messageBrief` + this target's `groundingFact` specifically.
      If there's no real grounding fact for this target, either research more (a
      `web_fetch_exa` on their actual site) or skip — a cold email with nothing specific
      to say is spam, not outreach.
   c. Run `linki-safe-send` with the verified contact and the drafted message. It performs
      its own suppression check and preview — don't skip straight to assuming this step
      always succeeds; if it reports suppressed or unhealthy-sender, that target is
      skipped, not retried through a workaround.

3. Stop at `maxSends` successful sends even if more verified targets remain in the list —
   report the remainder as "found and verified but not sent this run" so a human can see
   the pipeline didn't quietly send more than expected.

4. Produce a run summary: companies found, contacts verified, messages sent, and every
   skip with its reason (unverifiable email, suppressed, no grounding fact, sender
   unhealthy, cap reached). This is the audit trail that stands in for a pre-send approval
   gate — it must be complete enough that a human reading it after the fact can tell
   exactly what happened and why, for every target that was and wasn't contacted.

## Compliance checklist (do not skip)

Cold business email carries real legal obligations (CAN-SPAM in the US, and equivalent
rules elsewhere) and reputational ones (Linki's sending domain reputation is shared
across every campaign run through it):

- The message must identify who it's from — a real sender name and the sending
  organization, not an anonymous or spoofed identity.
- It must include a working way to opt out, and any opt-out or "stop contacting me" reply
  must result in that contact going on `suppression_manage`'s suppression list before
  anyone (agent or human) contacts them again on any channel.
- Only contact people for whom the offer is plausibly relevant — a `targetDescription`
  and `contactRole` this specific is what makes that true; don't widen targeting just to
  hit `maxSends`.
- Never buy, scrape, or import a third-party list into this pipeline. Every contact must
  come from `company-research`'s live, sourced discovery, with an `evidenceUrl` for where
  it came from.

## What NOT to do

- Don't inline the verification or send logic here instead of calling the atomic skills —
  if the suppression check or verify-or-drop policy ever needs to change, it should change
  in one place (`contact-email-discovery` / `linki-safe-send`), not in every pipeline that
  uses them.
- Don't treat "auto-send is enabled" as "skip the checks to go faster." Every guardrail in
  the atomic skills still applies; autonomy removes the human approval step, not the
  verification steps.

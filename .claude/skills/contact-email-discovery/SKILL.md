---
name: contact-email-discovery
description: Given a person's name and their company's domain, generate ranked candidate email addresses by common corporate patterns, then confirm one through Linki's verifier before treating it as real. Verify-or-drop — never hands a downstream skill an unconfirmed guess. Use whenever an agent has a name + domain but not a known-good email.
---

## When to use

After `company-research` (or any other source) has produced a person's name and a
company's domain, but no confirmed email address. This skill turns that into either one
verified, sendable address, or an explicit "could not confirm" — it never returns a bare
guess.

## Constraint that shapes this whole skill

Linki's `contact_create` tool requires **both** `full_name` and `linkedin_url` — it cannot
create a bare "name + guessed email" record. So a LinkedIn/profile URL for the person is a
prerequisite input, not optional metadata. If `company-research` didn't already produce
`contactProfileUrl`, go find it (a `category:people` Exa search on the name + company) before
starting this skill — there's no path through Linki's verifier without it.

## Steps

1. **Normalize the name.** Split into `first` and `last`. Lowercase, strip accents/spaces
   for the patterns below (e.g. "María García" → `maria`, `garcia`).

2. **Generate ranked candidate patterns** against the domain, most-common first:
   1. `first.last@domain` (e.g. `maria.garcia@acme.com`)
   2. `firstlast@domain`
   3. `first@domain`
   4. `flast@domain` (first initial + last name)
   5. `first.l@domain` (first name + last initial)
   6. `last.first@domain`
   7. `f.last@domain`

   Real companies are consistent internally, so if you already confirmed one person's
   pattern at this domain (this run or a prior one), skip straight to that pattern rather
   than re-testing all seven.

3. **Create (or reuse) a staging list** in Linki via `list_create` for this discovery
   batch, so verification results are scoped and easy to review.

4. **Test candidates one at a time, not all at once:**
   - `contact_create` with `full_name`, `linkedin_url`, `email: <candidate>`, `company`,
     `list_id` set to the staging list.
   - `list_verify_emails` on that `list_id` (or scoped to that `contact_id`).
   - `suppression_manage({ action: "check", kind: "email", value: <candidate> })` — Linki's
     verifier adds *definitively dead* addresses to the suppression list and leaves
     everything else (including merely-unverifiable addresses) as sendable. A hit here
     means the candidate is confirmed dead: drop it.
   - If suppressed: `contact_update` the same contact's `email` to the next candidate
     pattern and repeat verification. Reusing the contact record (rather than creating a
     new one per candidate) avoids leaving a pile of dead-guess contacts in the CRM.
   - If not suppressed after verification: treat this as the confirmed address, stop
     testing further patterns, and return it.

5. **If every pattern comes back suppressed** (or you have no domain-consistent pattern to
   fall back on), do not guess further or invent a variant. Return "no confirmed email for
   this person" and let the calling skill decide whether to hand this one to a human,
   skip the target, or fall back to `list_apollo_enrich` (Linki's own Apollo-backed
   enrichment) as a second, independent source before giving up entirely.

## Output contract

```
{ contactId, fullName, domain, email, verified: true } // success
{ contactId?, fullName, domain, email: null, verified: false, reason } // exhausted
```

Only records with `verified: true` are safe to pass into `linki-safe-send`.

## What NOT to do

- Never pass an untested pattern-guess straight to a send skill "because it's usually
  right." Usually is not verified. This is the entire point of the skill.
- Don't bulk-create all seven pattern guesses as separate contacts and verify them
  together — that creates six extra CRM records (most of them permanently dead-address
  contacts) for every one person you're actually trying to reach. Test sequentially and
  stop at the first confirmation.
- Don't remove or bypass a suppression entry to retest an address that already came back
  dead. Suppression in this system is permanent by design.

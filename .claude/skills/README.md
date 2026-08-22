# Agent skill library

A skill here is a small, self-contained recipe for using one or more **connected MCP
servers** to get a real piece of business work done, safely, without a human doing each
step by hand. The pattern is always the same shape:

1. **Discover** — find the raw material (companies, people, records, content) via a
   search/read-only MCP tool.
2. **Ground and verify** — turn a guess into a confirmed fact using a second tool, and
   drop anything that doesn't confirm. Never hand an unverified guess to a step that acts
   on the world.
3. **Act** — do the side-effecting thing (send, create, update) through the narrowest
   tool available, with a safety check (suppression list, dry-run preview, rate cap)
   immediately before the irreversible call.

Skills are meant to be **composed**, not just run standalone. The atomic skills in this
library —

- [`company-research`](company-research/SKILL.md) — find organizations/people matching a
  description (Exa)
- [`contact-email-discovery`](contact-email-discovery/SKILL.md) — turn a name + company
  domain into a *confirmed* email address (pattern-guess + Linki verify)
- [`linki-safe-send`](linki-safe-send/SKILL.md) — send one message through Linki with
  suppression/preview checks

— are each useful on their own. [`cold-outreach-campaign`](cold-outreach-campaign/SKILL.md)
is **one example** of chaining all three into an end-to-end pipeline (find target
companies → find and verify a contact → send). It is not the only thing this library is
for — the same discover → verify → act shape works for recruiting outreach, partnership
research, event invites, CRM hygiene sweeps, support-ticket triage, or anything else an
agent needs to do against a connected system.

## Adding a new skill

This project uses the [`skills`](https://skills.sh/) CLI to manage `.claude/skills/` —
it already recognizes everything in this directory (`npm run skills:list` / `npx skills
list` shows all four). Two ways to grow the library:

### Write a new local skill

```bash
npx skills init <kebab-case-name>     # or: npm run skills:init -- <kebab-case-name>
```

This scaffolds `<kebab-case-name>/SKILL.md` with the frontmatter Claude Code expects.
Fill it in following the same shape as the skills already here:

```markdown
---
name: kebab-case-name
description: One or two sentences — what it does and when an agent should reach for it.
---

## When to use
## Inputs / output contract
## Steps (numbered, naming the exact tool at each step)
## Guardrails (what must be verified/checked before the irreversible step, and what to do
  when a check fails — drop, retry, or hand off to a human)
## What NOT to do
```

This workspace has dozens of MCP servers connected beyond Exa and Linki — the Falorb
product API itself, HubSpot, Google Calendar/Gmail, Calendly, Supabase, Typeform, Clay,
and more (see the deferred-tools listing in context, or run `ToolSearch` with a keyword to
find one). A new skill for any of them follows this same template.

### Pull in a skill someone else already wrote, from GitHub

```bash
npx skills add <owner>/<repo>              # or a full https://github.com/... URL
npx skills add <owner>/<repo> --list       # preview what's in the package first, installs nothing
npx skills add <owner>/<repo> --skill <name>   # install only one skill from a multi-skill repo
npx skills add <owner>/<repo> -g           # install globally instead of just this project
```

This drops the fetched skill(s) into `.claude/skills/` alongside the ones written here
(tracked as `Source: github` in `npx skills list`, vs. `Source: local` for these). Always
run with `--list` first on a repo you haven't used before to see what it actually
contains, and read a skill's `SKILL.md` before trusting it with anything that acts on real
data — an imported skill runs with the same access as any skill in this directory, so the
guardrail expectations in this README apply to it too, whether or not its author wrote
them in.

Keep each skill scoped to one capability. If a task needs several capabilities chained
together, write the orchestrator as its own skill (like `cold-outreach-campaign`) that
*calls* the atomic ones rather than re-implementing their steps inline — that way a fix to
verification logic or a suppression check only has to happen in one place.

## Why the guardrails aren't optional

These skills act on real, external systems — Linki sends real email from a domain whose
deliverability reputation is shared across everything sent from it, and the CRM data they
touch is real prospect data. A skill that skips the verify-or-drop step, ignores the
suppression list, or sends without a preview isn't a faster version of the safe skill —
it's a different, riskier tool that happens to share a name. Every skill in this library
keeps the verify/guardrail step even when it adds a round-trip, and says explicitly what
to do when a check fails rather than leaving that to the calling agent's judgment.

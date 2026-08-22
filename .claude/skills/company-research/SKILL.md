---
name: company-research
description: Find companies (and, when needed, specific people at them) matching a natural-language description, using Exa web search — with a canonical domain and a grounding fact for each result. Use whenever an agent needs to build a target list of organizations or people from a criterion like "seed-stage devtools startups" or "the head of growth at each of these five companies," rather than a single known name.
---

## When to use

Any time the next step needs a *list* of real organizations or people matching a
description, not a single already-known target. This is a read-only discovery step — it
never writes anywhere. Downstream skills (like `contact-email-discovery`) consume its
output.

## Tools

- `web_search_exa` — semantic web search. Use `category:company` to bias results toward
  company sites/profiles, `category:people` to bias toward individual profiles (e.g.
  LinkedIn). Query with a rich natural-language description of the ideal result, not
  keywords: `"Series A fintech startups building payment infrastructure for SMBs"`, not
  `"fintech startup payments"`.
- `web_fetch_exa` — fetch full page content for a URL when the search highlight isn't
  enough to confirm a fact (e.g. you need the actual team page to get a name and title).
  Batch multiple URLs in one call rather than looping one at a time.

## Steps

1. Write one Exa query per distinct criterion. If the target has multiple independent
   constraints (industry + stage + geography), a single overloaded query returns worse
   results than two narrower ones you then intersect.
2. For company search, request enough results (`numResults`) to allow for dedup and
   irrelevant hits — search results include listicles, news mentions, and directory pages
   that are not the company's own site.
3. For each candidate, resolve a **canonical domain**: prefer the company's own site over
   a Crunchbase/LinkedIn/directory listing about it. If the search result *is* a directory
   page, `web_fetch_exa` it and look for the outbound link to the real site.
4. If you need a specific person (a role, not a name — "the founder", "head of sales"),
   run a `category:people` search scoped to that company/domain, and fetch the profile
   page to confirm the name, current title, and (if present) a public profile URL —
   downstream steps need this, since Linki's contact creation requires a profile URL, not
   just an email guess.
5. Capture one grounding fact per result (what they do, a recent post, a stated role) from
   the actual page content. This is what makes later outreach specific instead of generic
   — never invent a detail that didn't come from a fetched page.

## Output contract

Return a list of:

```
{ companyName, domain, evidenceUrl, contactName?, contactTitle?, contactProfileUrl?, groundingFact }
```

Dedup by `domain` before handing this list to any downstream skill — the same company
turns up from multiple queries and multiple listicles.

## What NOT to do

- Don't scrape LinkedIn or any gated site directly (fetching raw HTML with a scraper,
  bypassing login walls). Exa's `category:people`/`category:company` search already
  indexes public profile content through a licensed API — stay on that, consistent with
  this workspace's standing decision to avoid ToS/scraping risk for social/prospecting
  data.
- Don't fabricate a domain or contact detail when Exa comes back thin. Report "no
  confident match" for that item rather than guessing a plausible-looking domain — a wrong
  domain poisons every downstream step (wrong company, wrong email pattern, wrong send).

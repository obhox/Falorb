# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> property tabs >> /settings renders
- Location: e2e/dashboard.spec.ts:61:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { level: 1 })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { level: 1 })

```

```yaml
- main:
  - text: Falorb Self-hosted analytics
  - heading "Sign in" [level=2]
  - text: Every property on one page. Email
  - img
  - textbox "Email":
    - /placeholder: you@example.com
  - text: Password
  - img
  - textbox "Password":
    - /placeholder: ••••••••••
  - button "Sign in"
  - paragraph:
    - text: No account yet?
    - link "Create one":
      - /url: /sign-up
- alert
```

# Test source

```ts
  1  | import { readFileSync } from "node:fs";
  2  | import { resolve } from "node:path";
  3  | import { test as base, expect } from "@playwright/test";
  4  | import type { E2EAccount } from "./global-setup";
  5  | 
  6  | /**
  7  |  * Shared fixtures.
  8  |  *
  9  |  * `account` is what global setup provisioned — the generated credentials and
  10 |  * the seeded property slugs, so tests never hard-code a slug that the seed
  11 |  * might rename.
  12 |  */
  13 | 
  14 | export const test = base.extend<{ account: E2EAccount }>({
  15 |   account: async ({}, use) => {
  16 |     const path = resolve(import.meta.dirname, ".auth/account.json");
  17 |     await use(JSON.parse(readFileSync(path, "utf8")) as E2EAccount);
  18 |   },
  19 | });
  20 | 
  21 | export { expect };
  22 | 
  23 | /**
  24 |  * Assert a page rendered its data rather than its error boundary or an empty
  25 |  * state.
  26 |  *
  27 |  * Worth its own helper because the failure this catches is the quiet one: a
  28 |  * server component that throws renders the error boundary, which is a
  29 |  * perfectly valid-looking page. A test that only checked for a heading would
  30 |  * pass while every figure on the screen was missing.
  31 |  */
  32 | export async function expectRendered(page: import("@playwright/test").Page) {
  33 |   await expect(page.getByText("This panel could not load")).toHaveCount(0);
> 34 |   await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
     |                                                         ^ Error: expect(locator).toBeVisible() failed
  35 | }
  36 | 
  37 | /** Every mono figure on the page, as text. */
  38 | export async function figures(page: import("@playwright/test").Page): Promise<string[]> {
  39 |   return page.locator("[data-num], .mono").allInnerTexts();
  40 | }
  41 | 
```
# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> authentication >> does not reveal whether an address has an account
- Location: e2e/auth.spec.ts:56:3

# Error details

```
Error: locator.innerText: Error: strict mode violation: getByRole('alert') resolved to 2 elements:
    1) <p role="alert">Invalid origin</p> aka getByText('Invalid origin')
    2) <div role="alert" aria-live="assertive" id="__next-route-announcer__"></div> aka locator('[id="__next-route-announcer__"]')

Call log:
  - waiting for getByRole('alert')

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - main [ref=f1e2]:
    - generic [ref=f1e3]:
      - generic [ref=f1e4]:
        - generic [ref=f1e5]: Falorb
        - generic [ref=f1e6]: Self-hosted analytics
      - generic [ref=f1e9]:
        - generic [ref=f1e10]:
          - heading "Sign in" [level=2] [ref=f1e11]
          - generic [ref=f1e12]: Every property on one page.
        - generic [ref=f1e13]:
          - generic [ref=f1e14]:
            - generic [ref=f1e15]: Email
            - textbox "Email" [ref=f1e22]:
              - /placeholder: you@example.com
              - text: no-such-account@falorb.test
          - generic [ref=f1e23]:
            - generic [ref=f1e24]: Password
            - textbox "Password" [ref=f1e31]:
              - /placeholder: ••••••••••
              - text: wrong-password-entirely
        - alert [ref=f1e32]: Invalid origin
        - button "Sign in" [active] [ref=f1e33] [cursor=pointer]
      - paragraph [ref=f1e34]:
        - text: No account yet?
        - link "Create one" [ref=f1e35] [cursor=pointer]:
          - /url: /sign-up
  - alert [ref=f1e36]
```

# Test source

```ts
  1  | import { test, expect } from "./fixtures";
  2  | 
  3  | /**
  4  |  * The auth gate.
  5  |  *
  6  |  * Every one of these runs signed out — `storageState: undefined` overrides the
  7  |  * project default. The gate is the only thing standing between an anonymous
  8  |  * request and another organization's figures, so it is asserted directly
  9  |  * rather than inferred from the other tests passing.
  10 |  */
  11 | test.describe("authentication", () => {
  12 |   test.use({ storageState: { cookies: [], origins: [] } });
  13 | 
  14 |   test("sends anonymous visitors to sign-in", async ({ page }) => {
  15 |     await page.goto("/");
  16 |     await expect(page).toHaveURL(/\/sign-in$/);
  17 |     await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  18 |   });
  19 | 
  20 |   test("gates every dashboard route, not just the root", async ({ page, account }) => {
  21 |     const slug = account.primarySlug;
  22 |     const routes = [
  23 |       `/p/${slug}`,
  24 |       `/p/${slug}/people`,
  25 |       `/p/${slug}/settings`,
  26 |       "/insights",
  27 |       "/alerts",
  28 |       "/settings",
  29 |     ];
  30 | 
  31 |     for (const route of routes) {
  32 |       await page.goto(route);
  33 |       await expect(page, `${route} should redirect when signed out`).toHaveURL(/\/sign-in$/);
  34 |     }
  35 |   });
  36 | 
  37 |   test("refuses the live stream to anonymous callers", async ({ request, account }) => {
  38 |     const response = await request.get(`/api/live/${account.primarySlug}`, {
  39 |       maxRedirects: 0,
  40 |     });
  41 |     // The route calls requireProject, which redirects rather than streaming.
  42 |     expect(response.status(), "SSE must not open for an anonymous caller").not.toBe(200);
  43 |   });
  44 | 
  45 |   test("states the cause when credentials are wrong", async ({ page }) => {
  46 |     await page.goto("/sign-in");
  47 |     await page.getByLabel("Email").fill("nobody@falorb.test");
  48 |     await page.getByLabel("Password").fill("definitely-not-the-password");
  49 |     await page.getByRole("button", { name: "Sign in" }).click();
  50 | 
  51 |     await expect(page.getByRole("alert")).toBeVisible();
  52 |     // Still on sign-in — a failed attempt must not partially authenticate.
  53 |     await expect(page).toHaveURL(/\/sign-in$/);
  54 |   });
  55 | 
  56 |   test("does not reveal whether an address has an account", async ({ page, account }) => {
  57 |     async function attempt(email: string): Promise<string> {
  58 |       await page.goto("/sign-in");
  59 |       await page.getByLabel("Email").fill(email);
  60 |       await page.getByLabel("Password").fill("wrong-password-entirely");
  61 |       await page.getByRole("button", { name: "Sign in" }).click();
> 62 |       return page.getByRole("alert").innerText();
     |                                      ^ Error: locator.innerText: Error: strict mode violation: getByRole('alert') resolved to 2 elements:
  63 |     }
  64 | 
  65 |     const known = await attempt(account.email);
  66 |     const unknown = await attempt("no-such-account@falorb.test");
  67 | 
  68 |     // Asserting the two messages are byte-identical looks stricter but is the
  69 |     // wrong test: better-auth rate-limits repeated failures, so the second
  70 |     // attempt legitimately gets a throttling message and the comparison fails
  71 |     // for a reason that has nothing to do with disclosure.
  72 |     //
  73 |     // The property that actually matters is that neither response says whether
  74 |     // the address is registered.
  75 |     for (const [label, message] of [["known", known], ["unknown", unknown]] as const) {
  76 |       expect(message, `${label} address produced an empty message`).not.toBe("");
  77 |       expect(
  78 |         message.toLowerCase(),
  79 |         `${label} address disclosed account existence: ${message}`,
  80 |       ).not.toMatch(/no account|not found|does not exist|unknown (email|user)|never registered/);
  81 |     }
  82 |   });
  83 | });
  84 | 
```
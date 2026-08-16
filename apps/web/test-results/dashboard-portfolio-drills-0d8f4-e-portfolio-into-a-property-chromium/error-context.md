# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> portfolio >> drills from the portfolio into a property
- Location: e2e/dashboard.spec.ts:38:3

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for locator('a[href="/p/bund"]').first()

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]: Falorb
        - generic [ref=e6]: Self-hosted analytics
      - generic [ref=e9]:
        - generic [ref=e10]:
          - heading "Sign in" [level=2] [ref=e11]
          - generic [ref=e12]: Every property on one page.
        - generic [ref=e13]:
          - generic [ref=e14]:
            - generic [ref=e15]: Email
            - textbox "Email" [ref=e22]:
              - /placeholder: you@example.com
          - generic [ref=e23]:
            - generic [ref=e24]: Password
            - textbox "Password" [ref=e31]:
              - /placeholder: ••••••••••
        - button "Sign in" [ref=e32] [cursor=pointer]
      - paragraph [ref=e33]:
        - text: No account yet?
        - link "Create one" [ref=e34] [cursor=pointer]:
          - /url: /sign-up
  - alert [ref=e35]
```

# Test source

```ts
  1   | import { test, expect, expectRendered } from "./fixtures";
  2   | 
  3   | /**
  4   |  * Every dashboard route, signed in, against real data.
  5   |  *
  6   |  * The assertions deliberately look for *figures*, not just headings. A server
  7   |  * component whose query returns the wrong shape still renders a heading; what
  8   |  * disappears is the number underneath it.
  9   |  */
  10  | 
  11  | test.describe("portfolio", () => {
  12  |   test("lists every property with figures", async ({ page, account }) => {
  13  |     await page.goto("/");
  14  |     await expectRendered(page);
  15  | 
  16  |     await expect(page.getByRole("heading", { name: "All properties" })).toBeVisible();
  17  | 
  18  |     // Each seeded property is a link into its own summary.
  19  |     for (const slug of account.projectSlugs) {
  20  |       await expect(page.locator(`a[href="/p/${slug}"]`).first()).toBeVisible();
  21  |     }
  22  | 
  23  |     // The headline strip must carry real figures, not em-dashes.
  24  |     const visitors = page.getByText("UNIQUE VISITORS", { exact: false });
  25  |     await expect(visitors).toBeVisible();
  26  |     await expect(page.getByText("Sessions", { exact: true }).first()).toBeVisible();
  27  |   });
  28  | 
  29  |   test("range changes rewrite the URL and re-query", async ({ page }) => {
  30  |     await page.goto("/");
  31  |     await page.getByRole("button", { name: "7 days" }).click();
  32  | 
  33  |     await expect(page).toHaveURL(/range=7d/);
  34  |     await expectRendered(page);
  35  |     await expect(page.getByText("7 days", { exact: false }).first()).toBeVisible();
  36  |   });
  37  | 
  38  |   test("drills from the portfolio into a property", async ({ page, account }) => {
  39  |     await page.goto("/");
> 40  |     await page.locator(`a[href="/p/${account.projectSlugs[0]}"]`).first().click();
      |                                                                           ^ Error: locator.click: Test timeout of 45000ms exceeded.
  41  | 
  42  |     await expect(page).toHaveURL(new RegExp(`/p/${account.projectSlugs[0]}$`));
  43  |     await expectRendered(page);
  44  |     await expect(page.getByRole("link", { name: "Summary" })).toBeVisible();
  45  |   });
  46  | });
  47  | 
  48  | test.describe("property tabs", () => {
  49  |   const tabs = [
  50  |     { path: "", heading: "Visitors and sessions" },
  51  |     { path: "/people", heading: "Person" },
  52  |     { path: "/funnels", heading: "Steps" },
  53  |     { path: "/paths", heading: "Journeys" },
  54  |     { path: "/retention", heading: "Cohort retention" },
  55  |     { path: "/events", heading: "Event names" },
  56  |     { path: "/goals", heading: "Goals" },
  57  |     { path: "/settings", heading: "Install" },
  58  |   ];
  59  | 
  60  |   for (const tab of tabs) {
  61  |     test(`${tab.path || "/summary"} renders`, async ({ page, account }) => {
  62  |       const slug = account.primarySlug;
  63  |       await page.goto(`/p/${slug}${tab.path}`);
  64  | 
  65  |       await expectRendered(page);
  66  |       await expect(page.getByText(tab.heading, { exact: false }).first()).toBeVisible();
  67  |     });
  68  |   }
  69  | 
  70  |   test("carries the range across a tab switch", async ({ page, account }) => {
  71  |     const slug = account.primarySlug;
  72  |     await page.goto(`/p/${slug}?range=7d`);
  73  |     await page.getByRole("link", { name: "Paths" }).click();
  74  | 
  75  |     // Losing the range on navigation silently changes what the reader is
  76  |     // looking at, which is worse than resetting it visibly.
  77  |     await expect(page).toHaveURL(/range=7d/);
  78  |   });
  79  | });
  80  | 
  81  | test.describe("people", () => {
  82  |   test("lists people and opens a profile", async ({ page, account }) => {
  83  |     const slug = account.primarySlug;
  84  |     await page.goto(`/p/${slug}/people`);
  85  |     await expectRendered(page);
  86  | 
  87  |     const firstPerson = page.locator('a[href^="/people/"]').first();
  88  |     await expect(firstPerson).toBeVisible();
  89  |     await firstPerson.click();
  90  | 
  91  |     await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
  92  |     await expectRendered(page);
  93  |     await expect(page.getByText("Timeline", { exact: false }).first()).toBeVisible();
  94  |     await expect(page.getByText("Identity", { exact: true })).toBeVisible();
  95  |   });
  96  | 
  97  |   test("search narrows the list through the URL", async ({ page, account }) => {
  98  |     const slug = account.primarySlug;
  99  |     await page.goto(`/p/${slug}/people`);
  100 | 
  101 |     await page.getByPlaceholder("Search email, name or id").fill("zzz-no-such-person");
  102 |     await expect(page).toHaveURL(/q=zzz-no-such-person/, { timeout: 8_000 });
  103 | 
  104 |     // An empty result must name the cause and the remedy, per the content rule.
  105 |     await expect(page.getByText("No people match")).toBeVisible();
  106 |   });
  107 | 
  108 |   test("identified filter round-trips", async ({ page, account }) => {
  109 |     const slug = account.primarySlug;
  110 |     await page.goto(`/p/${slug}/people`);
  111 | 
  112 |     await page.getByText("Identified only").click();
  113 |     await expect(page).toHaveURL(/identified=1/);
  114 |     await expectRendered(page);
  115 |   });
  116 | });
  117 | 
  118 | test.describe("cross-project", () => {
  119 |   test("insights spans properties and offers the builder", async ({ page }) => {
  120 |     await page.goto("/insights");
  121 |     await expectRendered(page);
  122 | 
  123 |     await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  124 |     await expect(page.getByText("People across products")).toBeVisible();
  125 |   });
  126 | 
  127 |   test("changing the dimension re-queries", async ({ page }) => {
  128 |     await page.goto("/insights?dim=channel");
  129 |     await expectRendered(page);
  130 | 
  131 |     await page.goto("/insights?dim=country");
  132 |     await expectRendered(page);
  133 |     await expect(page.getByText("by country", { exact: false }).first()).toBeVisible();
  134 |   });
  135 | 
  136 |   test("alerts page lists rules and delivery caveats", async ({ page }) => {
  137 |     await page.goto("/alerts");
  138 |     await expectRendered(page);
  139 |     await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  140 |     await expect(page.getByText("Alert rules")).toBeVisible();
```
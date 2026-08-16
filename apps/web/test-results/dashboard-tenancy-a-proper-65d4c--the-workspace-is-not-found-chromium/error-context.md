# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> tenancy >> a property outside the workspace is not found
- Location: e2e/dashboard.spec.ts:154:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('That page does not exist')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('That page does not exist')

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
  141 |   });
  142 | 
  143 |   test("instance settings lists the seeded properties", async ({ page, account }) => {
  144 |     await page.goto("/settings");
  145 |     await expectRendered(page);
  146 | 
  147 |     for (const slug of account.projectSlugs) {
  148 |       await expect(page.locator(`a[href="/p/${slug}/settings"]`)).toBeVisible();
  149 |     }
  150 |   });
  151 | });
  152 | 
  153 | test.describe("tenancy", () => {
  154 |   test("a property outside the workspace is not found", async ({ page }) => {
  155 |     await page.goto("/p/definitely-not-a-real-property");
> 156 |     await expect(page.getByText("That page does not exist")).toBeVisible();
      |                                                              ^ Error: expect(locator).toBeVisible() failed
  157 |   });
  158 | 
  159 |   test("a person id outside the workspace is not found", async ({ page }) => {
  160 |     // Well-formed UUID, no such person — must 404 rather than error.
  161 |     await page.goto("/people/00000000-0000-4000-8000-000000000000");
  162 |     await expect(page.getByText("That page does not exist")).toBeVisible();
  163 |   });
  164 | 
  165 |   test("a malformed person id is not found rather than a crash", async ({ page }) => {
  166 |     await page.goto("/people/not-a-uuid");
  167 |     await expect(page.getByText("That page does not exist")).toBeVisible();
  168 |   });
  169 | });
  170 | 
```
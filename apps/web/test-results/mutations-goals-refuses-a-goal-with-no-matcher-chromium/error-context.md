# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mutations.spec.ts >> goals >> refuses a goal with no matcher
- Location: e2e/mutations.spec.ts:49:3

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Add goal' })

```

# Test source

```ts
  1   | import { like } from "drizzle-orm";
  2   | import { createDatabase, schema } from "@falorb/db";
  3   | import { test, expect, expectRendered } from "./fixtures";
  4   | 
  5   | /**
  6   |  * Writes: goals, settings, and the live stream.
  7   |  *
  8   |  * Cleanup runs in `afterAll` against the database rather than through the UI.
  9   |  * A test that deletes its own row as its last step only cleans up when it
  10  |  * passes, so a failing assertion leaves the row behind — and the next run then
  11  |  * fails differently, on the debris rather than the defect. Sweeping by name
  12  |  * prefix makes the suite idempotent no matter how a previous run ended.
  13  |  */
  14  | 
  15  | const GOAL_PREFIX = "E2E goal";
  16  | 
  17  | test.afterAll(async () => {
  18  |   await createDatabase()
  19  |     .delete(schema.goals)
  20  |     .where(like(schema.goals.name, `${GOAL_PREFIX}%`));
  21  | });
  22  | 
  23  | test.describe("goals", () => {
  24  |   test("creates, evaluates and removes a goal", async ({ page, account }) => {
  25  |     const slug = account.primarySlug;
  26  |     const name = `${GOAL_PREFIX} ${Date.now()}`;
  27  | 
  28  |     await page.goto(`/p/${slug}/goals`);
  29  |     await expectRendered(page);
  30  | 
  31  |     await page.getByRole("button", { name: "Add goal" }).click();
  32  |     await page.getByLabel("Name", { exact: true }).fill(name);
  33  |     await page.getByLabel("Event name").fill("$pageview");
  34  |     await page.getByRole("button", { name: "Create goal" }).click();
  35  | 
  36  |     // Exact: the name also appears in the attribution subtitle, because a
  37  |     // newly created goal with conversions becomes the attribution subject.
  38  |     await expect(page.getByText(name, { exact: true })).toBeVisible();
  39  | 
  40  |     // The row carries an evaluated figure, not just the definition — proving
  41  |     // the goal was run against ClickHouse and not merely stored.
  42  |     const remove = page.getByRole("button", { name: `Remove ${name}` });
  43  |     await expect(remove).toBeVisible();
  44  | 
  45  |     await remove.click();
  46  |     await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  47  |   });
  48  | 
  49  |   test("refuses a goal with no matcher", async ({ page, account }) => {
  50  |     const slug = account.primarySlug;
  51  |     await page.goto(`/p/${slug}/goals`);
  52  | 
> 53  |     await page.getByRole("button", { name: "Add goal" }).click();
      |                                                          ^ Error: locator.click: Test timeout of 45000ms exceeded.
  54  |     await page.getByLabel("Name", { exact: true }).fill("Missing matcher");
  55  |     await page.getByRole("button", { name: "Create goal" }).click();
  56  | 
  57  |     // Names the cause, and the dialog stays open so the input is not lost.
  58  |     await expect(page.getByText("Enter the event name", { exact: false })).toBeVisible();
  59  |   });
  60  | 
  61  |   test("attribution model is selectable and changes the URL", async ({ page, account }) => {
  62  |     const slug = account.primarySlug;
  63  |     await page.goto(`/p/${slug}/goals`);
  64  | 
  65  |     await page.getByRole("button", { name: "First touch" }).click();
  66  |     await expect(page).toHaveURL(/model=first_touch/);
  67  |     await expectRendered(page);
  68  |   });
  69  | });
  70  | 
  71  | test.describe("property settings", () => {
  72  |   test("shows a snippet carrying this property's public key", async ({ page, account }) => {
  73  |     const slug = account.primarySlug;
  74  |     await page.goto(`/p/${slug}/settings`);
  75  |     await expectRendered(page);
  76  | 
  77  |     const snippet = page.getByText("<script defer", { exact: false }).first();
  78  |     await expect(snippet).toBeVisible();
  79  |     await expect(snippet).toContainText("data-project=");
  80  |     await expect(snippet).toContainText("/t.js");
  81  |   });
  82  | 
  83  |   test("saves a changed retention window", async ({ page, account }) => {
  84  |     const slug = account.primarySlug;
  85  |     await page.goto(`/p/${slug}/settings`);
  86  | 
  87  |     const retention = page.getByLabel("Retention");
  88  |     const original = await retention.inputValue();
  89  | 
  90  |     await retention.fill("400");
  91  |     await page.getByRole("button", { name: "Save changes" }).click();
  92  |     await expect(page.getByRole("status")).toHaveText("Saved");
  93  | 
  94  |     await page.reload();
  95  |     await expect(page.getByLabel("Retention")).toHaveValue("400");
  96  | 
  97  |     // Put it back, so a re-run starts from the same state.
  98  |     await page.getByLabel("Retention").fill(original);
  99  |     await page.getByRole("button", { name: "Save changes" }).click();
  100 |     await expect(page.getByRole("status")).toHaveText("Saved");
  101 |   });
  102 | 
  103 |   test("rejects a retention window outside the allowed range", async ({ page, account }) => {
  104 |     const slug = account.primarySlug;
  105 |     await page.goto(`/p/${slug}/settings`);
  106 | 
  107 |     await page.getByLabel("Retention").fill("99999");
  108 |     await page.getByRole("button", { name: "Save changes" }).click();
  109 | 
  110 |     await expect(page.getByRole("status")).toContainText("between 1 and 3650");
  111 |   });
  112 | });
  113 | 
  114 | test.describe("live stream", () => {
  115 |   test("opens an SSE connection and reports itself live", async ({ page, account }) => {
  116 |     const slug = account.primarySlug;
  117 |     await page.goto(`/p/${slug}/live`);
  118 | 
  119 |     // "connecting" flips to "live" only once the server has sent its first
  120 |     // event, so this asserts the stream actually opened.
  121 |     await expect(page.getByText("live", { exact: false }).first()).toBeVisible({
  122 |       timeout: 20_000,
  123 |     });
  124 |     await expect(page.getByText("On site now")).toBeVisible();
  125 |   });
  126 | 
  127 |   test("streams a tick containing visitor state", async ({ page, account }) => {
  128 |     const slug = account.primarySlug;
  129 | 
  130 |     const tick = page.waitForEvent("console", {
  131 |       predicate: () => true,
  132 |       timeout: 1_000,
  133 |     }).catch(() => null);
  134 | 
  135 |     await page.goto(`/p/${slug}/live`);
  136 |     await tick;
  137 | 
  138 |     // The figure starts as an em-dash and becomes a number on the first tick.
  139 |     const onSiteNow = page.locator("text=On site now").locator("..");
  140 |     await expect(onSiteNow).not.toContainText("—", { timeout: 20_000 });
  141 |   });
  142 | });
  143 | 
```
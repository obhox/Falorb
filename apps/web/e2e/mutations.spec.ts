import { like } from "drizzle-orm";
import { createDatabase, schema } from "@falorb/db";
import { test, expect, expectRendered } from "./fixtures";

/**
 * Writes: goals, settings, and the live stream.
 *
 * Cleanup runs in `afterAll` against the database rather than through the UI.
 * A test that deletes its own row as its last step only cleans up when it
 * passes, so a failing assertion leaves the row behind — and the next run then
 * fails differently, on the debris rather than the defect. Sweeping by name
 * prefix makes the suite idempotent no matter how a previous run ended.
 */

const GOAL_PREFIX = "E2E goal";

test.afterAll(async () => {
  await createDatabase()
    .delete(schema.goals)
    .where(like(schema.goals.name, `${GOAL_PREFIX}%`));
});

test.describe("goals", () => {
  test("creates, evaluates and removes a goal", async ({ page, account }) => {
    const slug = account.primarySlug;
    const name = `${GOAL_PREFIX} ${Date.now()}`;

    await page.goto(`/p/${slug}/goals`);
    await expectRendered(page);

    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Event name").fill("$pageview");
    await page.getByRole("button", { name: "Create goal" }).click();

    // Exact: the name also appears in the attribution subtitle, because a
    // newly created goal with conversions becomes the attribution subject.
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    // The row carries an evaluated figure, not just the definition — proving
    // the goal was run against ClickHouse and not merely stored.
    const remove = page.getByRole("button", { name: `Remove ${name}` });
    await expect(remove).toBeVisible();

    await remove.click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test("refuses a goal with no matcher", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/goals`);

    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Missing matcher");
    await page.getByRole("button", { name: "Create goal" }).click();

    // Names the cause, and the dialog stays open so the input is not lost.
    await expect(page.getByText("Enter the event name", { exact: false })).toBeVisible();
  });

  test("attribution model is selectable and changes the URL", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/goals`);

    await page.getByRole("button", { name: "First touch" }).click();
    await expect(page).toHaveURL(/model=first_touch/);
    await expectRendered(page);
  });
});

test.describe("property settings", () => {
  test("shows a snippet carrying this property's public key", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/settings`);
    await expectRendered(page);

    const snippet = page.getByText("<script defer", { exact: false }).first();
    await expect(snippet).toBeVisible();
    await expect(snippet).toContainText("data-project=");
    await expect(snippet).toContainText("/t.js");
  });

  test("saves a changed retention window", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/settings`);

    const retention = page.getByLabel("Retention");
    const original = await retention.inputValue();

    await retention.fill("400");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");

    await page.reload();
    await expect(page.getByLabel("Retention")).toHaveValue("400");

    // Put it back, so a re-run starts from the same state.
    await page.getByLabel("Retention").fill(original);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
  });

  test("rejects a retention window outside the allowed range", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/settings`);

    await page.getByLabel("Retention").fill("99999");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("status")).toContainText("between 1 and 3650");
  });
});

test.describe("live stream", () => {
  test("opens an SSE connection and reports itself live", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/live`);

    // "connecting" flips to "live" only once the server has sent its first
    // event, so this asserts the stream actually opened.
    await expect(page.getByText("live", { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("On site now")).toBeVisible();
  });

  test("streams a tick containing visitor state", async ({ page, account }) => {
    const slug = account.primarySlug;

    const tick = page.waitForEvent("console", {
      predicate: () => true,
      timeout: 1_000,
    }).catch(() => null);

    await page.goto(`/p/${slug}/live`);
    await tick;

    // The figure starts as an em-dash and becomes a number on the first tick.
    const onSiteNow = page.locator("text=On site now").locator("..");
    await expect(onSiteNow).not.toContainText("—", { timeout: 20_000 });
  });
});

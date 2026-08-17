import { isNotNull } from "drizzle-orm";
import { createDatabase, schema } from "@falorb/db";
import { test, expect, expectRendered } from "./fixtures";

/**
 * Action feedback.
 *
 * These exist because of a specific report: buttons that appeared stuck. Three
 * separate defects produced that impression and each is pinned here.
 *
 *   "Create alert" was hard-disabled whenever the workspace had no delivery
 *   channel, so it could never be pressed and the only explanation was small
 *   print inside the dialog.
 *
 *   Nothing indicated work in progress. `pending` came from a transition that
 *   only covered the refresh, not the action's own round trip.
 *
 *   A refused or thrown action said nothing at all.
 */

test.afterAll(async () => {
  const db = createDatabase();
  await db.delete(schema.alertChannels).where(isNotNull(schema.alertChannels.id));
});

/**
 * The toast, not Next's route announcer.
 *
 * `[id="__next-route-announcer__"]` also carries role="alert" and is always
 * present, so an unscoped getByRole("alert") is ambiguous on every page.
 */
function toastError(page: import("@playwright/test").Page) {
  return page.locator('[role="alert"]:not([id="__next-route-announcer__"])');
}

test.describe("action feedback", () => {
  test("the create button is reachable even with no delivery channel", async ({ page }) => {
    await page.goto("/alerts");
    await expectRendered(page);

    // Start from a workspace with no channels, which is the reported state.
    const revoke = page.getByRole("button", { name: /^Remove / });
    for (let i = await revoke.count(); i > 0; i--) {
      await revoke.first().click();
      await page.waitForTimeout(300);
    }

    await page.getByRole("button", { name: "Add alert" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Feedback probe");

    const create = page.getByRole("button", { name: "Create alert" });
    // The regression: this used to be permanently disabled.
    await expect(create).toBeEnabled();

    await create.click();

    // And pressing it now explains why it cannot proceed, rather than doing
    // nothing observable.
    await expect(toastError(page)).toContainText(/deliver/i);
  });

  test("a successful action reports itself", async ({ page }) => {
    await page.goto("/alerts");
    await expectRendered(page);

    await page.getByRole("button", { name: "Add channel" }).click();
    await page.getByLabel("Name", { exact: true }).fill("E2E webhook");
    await page.getByRole("button", { name: "Webhook", exact: true }).click();
    await page.getByLabel("Webhook URL").fill("https://example.com/hooks/falorb");
    await page.getByRole("button", { name: "Add channel" }).last().click();

    await expect(page.getByRole("status").filter({ hasText: "Channel added" })).toBeVisible();
    await expect(page.getByText("E2E webhook")).toBeVisible();
  });

  test("a rejected action surfaces the reason", async ({ page }) => {
    await page.goto("/alerts");
    await expectRendered(page);

    await page.getByRole("button", { name: "Add channel" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Bad target");
    await page.getByRole("button", { name: "Webhook", exact: true }).click();
    // Rejected by the SSRF screen, so the message comes from the server rather
    // than from client-side validation.
    await page.getByLabel("Webhook URL").fill("https://127.0.0.1/hook");
    await page.getByRole("button", { name: "Add channel" }).last().click();

    await expect(toastError(page)).toBeVisible();
    // The dialog stays open, so what was typed is not lost.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Bad target");
  });

  test("an error toast persists until dismissed", async ({ page }) => {
    await page.goto("/alerts");
    await page.getByRole("button", { name: "Add alert" }).click();
    await page.getByLabel("Name", { exact: true }).fill("");
    await page.getByRole("button", { name: "Create alert" }).click();

    const toast = toastError(page).first();
    await expect(toast).toBeVisible();

    // Well past the success auto-dismiss window: a failure must not vanish
    // before it has been read.
    await page.waitForTimeout(5_500);
    await expect(toast).toBeVisible();

    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toHaveCount(0);
  });
});

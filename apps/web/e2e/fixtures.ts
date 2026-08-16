import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect } from "@playwright/test";
import type { E2EAccount } from "./global-setup";

/**
 * Shared fixtures.
 *
 * `account` is what global setup provisioned — the generated credentials and
 * the seeded property slugs, so tests never hard-code a slug that the seed
 * might rename.
 */

export const test = base.extend<{ account: E2EAccount }>({
  account: async ({}, use) => {
    const path = resolve(import.meta.dirname, ".auth/account.json");
    await use(JSON.parse(readFileSync(path, "utf8")) as E2EAccount);
  },
});

export { expect };

/**
 * Assert a page rendered its data rather than its error boundary or an empty
 * state.
 *
 * Worth its own helper because the failure this catches is the quiet one: a
 * server component that throws renders the error boundary, which is a
 * perfectly valid-looking page. A test that only checked for a heading would
 * pass while every figure on the screen was missing.
 */
export async function expectRendered(page: import("@playwright/test").Page) {
  await expect(page.getByText("This panel could not load")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Every mono figure on the page, as text. */
export async function figures(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator("[data-num], .mono").allInnerTexts();
}

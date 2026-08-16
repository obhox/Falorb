import { isNotNull } from "drizzle-orm";
import { createDatabase, schema } from "@falorb/db";
import { test, expect, expectRendered } from "./fixtures";

/**
 * Public share links.
 *
 * The assertions that matter here are the negative ones. A share link is a
 * bearer capability handed to people outside the workspace, so the tests prove
 * what it *cannot* reach as carefully as what it renders.
 */

test.afterAll(async () => {
  // Revoke anything this file created, so a re-run starts unshared and the
  // "create a link" test is exercising creation rather than rotation.
  await createDatabase()
    .update(schema.dashboards)
    .set({ publicToken: null })
    .where(isNotNull(schema.dashboards.publicToken));
});

async function createLink(page: import("@playwright/test").Page, slug: string) {
  await page.goto(`/p/${slug}/settings`);
  await expectRendered(page);

  const existing = page.getByRole("button", { name: "Revoke" });
  if (await existing.isVisible().catch(() => false)) {
    await existing.click();
  }

  await page.getByRole("button", { name: "Create public link" }).click();
  const field = page.getByText("/share/", { exact: false }).first();
  await expect(field).toBeVisible();

  const url = (await field.innerText()).trim();
  expect(url).toContain("/share/");
  return url;
}

test.describe("public sharing", () => {
  test("creates a link that opens without a session", async ({ page, account, browser }) => {
    const url = await createLink(page, account.primarySlug);
    const path = new URL(url).pathname;

    // A brand-new context: no cookies, nothing inherited from the signed-in one.
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await anonymous.newPage();
    await guest.goto(path);

    await expect(guest.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(guest.getByText("shared read-only")).toBeVisible();
    await expect(guest.getByText("Unique visitors", { exact: false }).first()).toBeVisible();

    await anonymous.close();
  });

  test("exposes aggregates only — no people, sessions or other properties", async ({
    page,
    account,
    browser,
  }) => {
    const url = await createLink(page, account.primarySlug);
    const path = new URL(url).pathname;

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await anonymous.newPage();
    await guest.goto(path);

    // No route out of the shared page into anything person-level.
    await expect(guest.locator('a[href^="/people/"]')).toHaveCount(0);
    await expect(guest.locator('a[href^="/p/"]')).toHaveCount(0);
    await expect(guest.getByText("Identified", { exact: false })).toHaveCount(0);

    // The other seeded properties must not be named anywhere on the page.
    const body = (await guest.locator("body").innerText()).toLowerCase();
    for (const slug of account.projectSlugs.filter((s) => s !== account.primarySlug)) {
      expect(body, `shared page leaked sibling property "${slug}"`).not.toContain(slug);
    }

    await anonymous.close();
  });

  test("is marked noindex", async ({ page, account, browser }) => {
    const url = await createLink(page, account.primarySlug);
    const path = new URL(url).pathname;

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await anonymous.newPage();
    await guest.goto(path);

    const robots = guest.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);

    await anonymous.close();
  });

  test("revoking stops the link resolving", async ({ page, account, browser }) => {
    const url = await createLink(page, account.primarySlug);
    const path = new URL(url).pathname;

    await page.goto(`/p/${account.primarySlug}/settings`);
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("button", { name: "Create public link" })).toBeVisible();

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await anonymous.newPage();
    await guest.goto(path);

    await expect(guest.getByText("This link is not available")).toBeVisible();
    await anonymous.close();
  });

  test("replacing a link invalidates the previous one", async ({ page, account, browser }) => {
    const first = new URL(await createLink(page, account.primarySlug)).pathname;

    await page.getByRole("button", { name: "Replace link" }).click();
    // Wait for the field to show a different token.
    await expect
      .poll(async () =>
        (await page.getByText("/share/", { exact: false }).first().innerText()).trim(),
      )
      .not.toContain(first.split("/share/")[1]!);

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await anonymous.newPage();
    await guest.goto(first);

    await expect(guest.getByText("This link is not available")).toBeVisible();
    await anonymous.close();
  });

  test("an invented token is not available", async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await anonymous.newPage();

    for (const token of ["not-a-real-token", "../../etc/passwd", "a".repeat(200)]) {
      await guest.goto(`/share/${encodeURIComponent(token)}`);
      await expect(guest.getByText("This link is not available")).toBeVisible();
    }

    await anonymous.close();
  });
});

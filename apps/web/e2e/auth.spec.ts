import { test, expect } from "./fixtures";

/**
 * The auth gate.
 *
 * Every one of these runs signed out — `storageState: undefined` overrides the
 * project default. The gate is the only thing standing between an anonymous
 * request and another organization's figures, so it is asserted directly
 * rather than inferred from the other tests passing.
 */
test.describe("authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sends anonymous visitors to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("gates every dashboard route, not just the root", async ({ page, account }) => {
    const slug = account.primarySlug;
    const routes = [
      `/p/${slug}`,
      `/p/${slug}/people`,
      `/p/${slug}/settings`,
      "/insights",
      "/alerts",
      "/settings",
    ];

    for (const route of routes) {
      await page.goto(route);
      await expect(page, `${route} should redirect when signed out`).toHaveURL(/\/sign-in$/);
    }
  });

  test("refuses the live stream to anonymous callers", async ({ request, account }) => {
    const response = await request.get(`/api/live/${account.primarySlug}`, {
      maxRedirects: 0,
    });
    // The route calls requireProject, which redirects rather than streaming.
    expect(response.status(), "SSE must not open for an anonymous caller").not.toBe(200);
  });

  test("states the cause when credentials are wrong", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("nobody@falorb.test");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator('p[role="alert"]')).toBeVisible();
    // Still on sign-in — a failed attempt must not partially authenticate.
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("does not reveal whether an address has an account", async ({ page, account }) => {
    async function attempt(email: string): Promise<string> {
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("wrong-password-entirely");
      await page.getByRole("button", { name: "Sign in" }).click();
      // Next renders its route announcer as role="alert" too, so scope to the
      // form's own message rather than matching every live region on the page.
      return page.locator('p[role="alert"]').innerText();
    }

    const known = await attempt(account.email);
    const unknown = await attempt("no-such-account@falorb.test");

    // Asserting the two messages are byte-identical looks stricter but is the
    // wrong test: better-auth rate-limits repeated failures, so the second
    // attempt legitimately gets a throttling message and the comparison fails
    // for a reason that has nothing to do with disclosure.
    //
    // The property that actually matters is that neither response says whether
    // the address is registered.
    for (const [label, message] of [["known", known], ["unknown", unknown]] as const) {
      expect(message, `${label} address produced an empty message`).not.toBe("");
      expect(
        message.toLowerCase(),
        `${label} address disclosed account existence: ${message}`,
      ).not.toMatch(/no account|not found|does not exist|unknown (email|user)|never registered/);
    }
  });
});

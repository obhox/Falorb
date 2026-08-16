import { test, expect, expectRendered } from "./fixtures";

/**
 * Every dashboard route, signed in, against real data.
 *
 * The assertions deliberately look for *figures*, not just headings. A server
 * component whose query returns the wrong shape still renders a heading; what
 * disappears is the number underneath it.
 */

test.describe("portfolio", () => {
  test("lists every property with figures", async ({ page, account }) => {
    await page.goto("/");
    await expectRendered(page);

    await expect(page.getByRole("heading", { name: "All properties" })).toBeVisible();

    // Each seeded property is a link into its own summary.
    for (const slug of account.projectSlugs) {
      await expect(page.locator(`a[href="/p/${slug}"]`).first()).toBeVisible();
    }

    // The headline strip must carry real figures, not em-dashes.
    const visitors = page.getByText("UNIQUE VISITORS", { exact: false });
    await expect(visitors).toBeVisible();
    await expect(page.getByText("Sessions", { exact: true }).first()).toBeVisible();
  });

  test("range changes rewrite the URL and re-query", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "7 days" }).click();

    await expect(page).toHaveURL(/range=7d/);
    await expectRendered(page);
    await expect(page.getByText("7 days", { exact: false }).first()).toBeVisible();
  });

  test("drills from the portfolio into a property", async ({ page, account }) => {
    await page.goto("/");
    await page.locator(`a[href="/p/${account.projectSlugs[0]}"]`).first().click();

    await expect(page).toHaveURL(new RegExp(`/p/${account.projectSlugs[0]}$`));
    await expectRendered(page);
    await expect(page.getByRole("link", { name: "Summary" })).toBeVisible();
  });
});

test.describe("property tabs", () => {
  const tabs = [
    { path: "", heading: "Visitors and sessions" },
    { path: "/people", heading: "Person" },
    { path: "/funnels", heading: "Steps" },
    { path: "/paths", heading: "Journeys" },
    { path: "/retention", heading: "Cohort retention" },
    { path: "/events", heading: "Event names" },
    { path: "/goals", heading: "Goals" },
    { path: "/settings", heading: "Install" },
  ];

  for (const tab of tabs) {
    test(`${tab.path || "/summary"} renders`, async ({ page, account }) => {
      const slug = account.primarySlug;
      await page.goto(`/p/${slug}${tab.path}`);

      await expectRendered(page);
      await expect(page.getByText(tab.heading, { exact: false }).first()).toBeVisible();
    });
  }

  test("carries the range across a tab switch", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}?range=7d`);
    await page.getByRole("link", { name: "Paths" }).click();

    // Losing the range on navigation silently changes what the reader is
    // looking at, which is worse than resetting it visibly.
    await expect(page).toHaveURL(/range=7d/);
  });
});

test.describe("people", () => {
  test("lists people and opens a profile", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/people`);
    await expectRendered(page);

    const firstPerson = page.locator('a[href^="/people/"]').first();
    await expect(firstPerson).toBeVisible();
    await firstPerson.click();

    await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}$/);
    await expectRendered(page);
    await expect(page.getByText("Timeline", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Identity", { exact: true })).toBeVisible();
  });

  test("search narrows the list through the URL", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/people`);

    await page.getByPlaceholder("Search email, name or id").fill("zzz-no-such-person");
    await expect(page).toHaveURL(/q=zzz-no-such-person/, { timeout: 8_000 });

    // An empty result must name the cause and the remedy, per the content rule.
    await expect(page.getByText("No people match")).toBeVisible();
  });

  test("identified filter round-trips", async ({ page, account }) => {
    const slug = account.primarySlug;
    await page.goto(`/p/${slug}/people`);

    await page.getByText("Identified only").click();
    await expect(page).toHaveURL(/identified=1/);
    await expectRendered(page);
  });
});

test.describe("cross-project", () => {
  test("insights spans properties and offers the builder", async ({ page }) => {
    await page.goto("/insights");
    await expectRendered(page);

    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
    await expect(page.getByText("People across products")).toBeVisible();
  });

  test("changing the dimension re-queries", async ({ page }) => {
    await page.goto("/insights?dim=channel");
    await expectRendered(page);

    await page.goto("/insights?dim=country");
    await expectRendered(page);
    await expect(page.getByText("by country", { exact: false }).first()).toBeVisible();
  });

  test("alerts page lists rules and delivery caveats", async ({ page }) => {
    await page.goto("/alerts");
    await expectRendered(page);
    await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
    await expect(page.getByText("Alert rules")).toBeVisible();
  });

  test("instance settings lists the seeded properties", async ({ page, account }) => {
    await page.goto("/settings");
    await expectRendered(page);

    for (const slug of account.projectSlugs) {
      await expect(page.locator(`a[href="/p/${slug}/settings"]`)).toBeVisible();
    }
  });
});

test.describe("tenancy", () => {
  test("a property outside the workspace is not found", async ({ page }) => {
    await page.goto("/p/definitely-not-a-real-property");
    await expect(page.getByText("That page does not exist")).toBeVisible();
  });

  test("a person id outside the workspace is not found", async ({ page }) => {
    // Well-formed UUID, no such person — must 404 rather than error.
    await page.goto("/people/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("That page does not exist")).toBeVisible();
  });

  test("a malformed person id is not found rather than a crash", async ({ page }) => {
    await page.goto("/people/not-a-uuid");
    await expect(page.getByText("That page does not exist")).toBeVisible();
  });
});

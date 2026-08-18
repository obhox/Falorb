import { test, expect, expectRendered } from "./fixtures";

/**
 * The connection panel.
 *
 * This is the screen someone lands on immediately after pasting the snippet,
 * so the assertions here are about it answering the question honestly rather
 * than looking reassuring: the state badge must reflect the data, the
 * diagnostics must be present when nothing is arriving, and the test button
 * must not offer a test it cannot run.
 */

test.describe("connection status", () => {
  test("reports whether the property is receiving events", async ({ page, account }) => {
    await page.goto(`/p/${account.primarySlug}/settings`);
    await expectRendered(page);

    await expect(page.getByText("Connection", { exact: true })).toBeVisible();

    // One of the three states, never a blank. The seeded property has events,
    // though whether they are inside the 24h window depends on the seed's age,
    // so both "connected" and "no recent events" are legitimate here.
    const badge = page.getByText(/Connected|No recent events|Waiting for the first event/);
    await expect(badge.first()).toBeVisible();
  });

  test("shows the underlying signals, not just a verdict", async ({ page, account }) => {
    await page.goto(`/p/${account.primarySlug}/settings`);
    await expectRendered(page);

    for (const label of ["EVENTS RECEIVED", "LAST EVENT", "COLLECTOR", "LOCATION DATA"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("surfaces which geo source is live", async ({ page, account }) => {
    await page.goto(`/p/${account.primarySlug}/settings`);
    await expectRendered(page);

    // The three phrasings correspond to database / header / none. Whichever is
    // true, the panel must say something specific rather than stay silent —
    // this is the gap that made an empty Countries card unexplainable.
    await expect(
      page.getByText(
        /Country, region and city|Country only|Unavailable — country will be empty/,
      ),
    ).toBeVisible();
  });

  test("offers a test for every configured domain, and none when there are none", async ({
    page,
    account,
  }) => {
    await page.goto(`/p/${account.primarySlug}/settings`);
    await expectRendered(page);

    const field = await page.getByLabel("Domains").inputValue();
    const domains = field
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    const buttons = page.getByRole("button", { name: "Test", exact: true });

    if (domains.length) {
      // One per domain, not one per property. A pageview from the marketing
      // site must not be allowed to vouch for an app with no snippet.
      await expect(buttons).toHaveCount(domains.length);
      for (const domain of domains) {
        await expect(page.getByText(domain, { exact: true }).first()).toBeVisible();
      }
      await expect(buttons.first()).toBeEnabled();
    } else {
      // Without an authorised domain the test has nowhere to send the reader,
      // and any event from elsewhere would be rejected at the edge anyway.
      await expect(buttons).toHaveCount(0);
      await expect(page.getByText("Add a domain below to enable the test.")).toBeVisible();
    }
  });

  test("reports each domain separately", async ({ page, account }) => {
    await page.goto(`/p/${account.primarySlug}/settings`);
    await expectRendered(page);

    const domains = (await page.getByLabel("Domains").inputValue())
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    test.skip(domains.length < 2, "needs a property with more than one domain");

    // The seed sends every event to the first domain, so a second one is
    // genuinely uninstalled — and the panel must say so rather than inheriting
    // the property's verdict.
    const rows = page.getByText(/Connected|No recent events|Waiting/);
    await expect(rows).toHaveCount(domains.length + 1); // + the property badge
  });

  test("the workspace list offers a test per domain", async ({ page, account }) => {
    await page.goto("/settings");
    await expectRendered(page);

    // The domains column is where someone scanning ten properties notices the
    // one that stopped, so the test belongs there too.
    await expect(page.getByText("press a domain to test its connection")).toBeVisible();

    const chips = page.getByTitle(/Test the connection for/);
    // Every seeded property has at least one domain, so there is one chip per
    // domain across the whole list — never zero.
    expect(await chips.count()).toBeGreaterThanOrEqual(account.projectSlugs.length);
    await expect(chips.first()).toBeEnabled();
  });

  test("explains what to check when nothing is arriving", async ({ page, account }) => {
    await page.goto(`/p/${account.primarySlug}/settings`);
    await expectRendered(page);

    const connected = await page.getByText("Connected", { exact: true }).count();
    if (connected > 0) {
      // A healthy property does not need the troubleshooting list taking up
      // room on the page.
      await expect(page.getByText("If nothing arrives")).toHaveCount(0);
    } else {
      await expect(page.getByText("If nothing arrives")).toBeVisible();
      await expect(page.getByText(/ad-blocker/i)).toBeVisible();
    }
  });
});

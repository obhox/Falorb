// @ts-check
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Product screenshots of the demo workspace.
 *
 * Run against the demo seed (`pnpm --filter @falorb/db seed:demo`) and a
 * running dashboard. Produces two kinds of image:
 *
 *   full/   — a whole screen, in both themes
 *   cards/  — one panel, cropped to its own bounds
 *
 * The card crops exist because a full screen is often the wrong asset: a
 * feature that lives in one panel reads better as that panel than as a
 * 1600px-wide page with the panel somewhere inside it.
 *
 * Capturing the whole screen needs a little care. The dashboard does not
 * scroll the document — the shell is fixed and the page body is an inner
 * scroll container — so Playwright's `fullPage` would return exactly one
 * viewport. Instead the viewport is grown to the content before each shot.
 *
 *   BASE_URL=http://localhost:3000 node scripts/shots.mjs
 */

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SHOTS_EMAIL;
const PASSWORD = process.env.SHOTS_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set SHOTS_EMAIL and SHOTS_PASSWORD to the demo account's credentials before running this script.");
  process.exit(1);
}
const OUT = resolve(import.meta.dirname, "../../../shots");
const SHARE_TOKEN = "fx8Qm2LbVn4pTwRe6YsKdH";
const INVITE_TOKEN = "hZ3vQpLmR7dNwT2sKfB9xC";

const WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
/** Beyond this a "page" screenshot is a poster, not a screenshot. */
const MAX_HEIGHT = 5200;

const THEMES = /** @type {const} */ (["dark", "light"]);

/**
 * Hide the dev server's own furniture.
 *
 * `next dev` renders a floating logo button and its overlay portal into every
 * page. It sits in the corner of every screenshot, and it is not part of the
 * product — a marketing asset with a framework's dev badge in it is unusable.
 * Injected as a stylesheet rather than removed from the DOM so nothing the app
 * renders is disturbed.
 */
const HIDE_DEV_CHROME = `
  nextjs-portal,
  [data-nextjs-dev-tools-button],
  [data-next-mark],
  #next-logo { display: none !important; }
`;

/** Every screen worth a full-page shot. */
const PAGES = [
  { name: "01-portfolio", path: "/", wait: "text=Properties" },
  { name: "02-project-summary", path: "/p/beacon", wait: "text=Visitors and sessions" },
  { name: "29-client-workspace", path: "/", wait: "text=Properties", workspace: "client" },
  { name: "04-people", path: "/p/beacon/people", wait: "text=Identified only" },
  { name: "05-funnels", path: "/p/beacon/funnels", wait: "text=Saved funnels" },
  { name: "06-paths", path: "/p/beacon/paths", wait: "text=Entry pages" },
  { name: "07-retention-daily", path: "/p/beacon/retention", wait: "text=Cohort retention" },
  { name: "08-retention-weekly", path: "/p/beacon/retention?by=week&range=90d", wait: "text=Cohort retention" },
  { name: "09-events", path: "/p/beacon/events", wait: "text=Event names" },
  { name: "10-ai-crawlers", path: "/p/beacon/crawlers", wait: "text=AI assistants" },
  { name: "11-goals", path: "/p/beacon/goals", wait: "text=Attribution" },
  { name: "12-project-settings", path: "/p/beacon/settings", wait: "text=Install" },
  { name: "13-insights", path: "/insights", wait: "text=People across products" },
  { name: "14-alerts", path: "/alerts", wait: "text=Alert rules" },
  { name: "15-settings", path: "/settings", wait: "text=Endpoints" },
  { name: "16-team", path: "/settings/team", wait: "text=Pending invitations" },
  { name: "17-mcp-and-keys", path: "/settings/mcp", wait: "text=Connect an assistant" },
  { name: "18-add-property", path: "/settings/new", wait: "text=Add property" },
  { name: "19-invitation", path: `/invite/${INVITE_TOKEN}`, wait: "text=Invitation" },
  // A second property, so the portfolio does not look like one site with tabs.
  { name: "20-ledgerly-summary", path: "/p/ledgerly", wait: "text=Visitors and sessions" },
  { name: "21-ledgerly-funnels", path: "/p/ledgerly/funnels", wait: "text=Saved funnels" },
  { name: "22-fintra-crawlers", path: "/p/fintra/crawlers", wait: "text=AI assistants" },
  { name: "23-notewell-summary", path: "/p/notewell", wait: "text=Visitors and sessions" },
  { name: "24-acme-summary", path: "/p/acme", wait: "text=Visitors and sessions" },
];

/** Screens that must be shot signed out. */
const PUBLIC_PAGES = [
  { name: "25-sign-in", path: "/sign-in", wait: "text=Every property on one page" },
  { name: "26-sign-up", path: "/sign-up", wait: "button:has-text('Create account')" },
  { name: "27-public-share", path: `/share/${SHARE_TOKEN}`, wait: "text=shared read-only" },
];

/**
 * Panels worth cropping out on their own.
 *
 * `title` matches the panel's heading. Card and ChartFrame render different
 * elements for it — an h3 and a span — so the selector matches on the heading
 * text inside the section's header rather than on a tag.
 */
const CARDS = [
  { page: "/", name: "portfolio-kpis", strip: 1, wait: "text=Properties" },
  { page: "/", name: "portfolio-properties", strip: 2, wait: "text=Properties" },

  { page: "/p/beacon", name: "summary-kpis", strip: 1, wait: "text=Visitors and sessions" },
  { page: "/p/beacon", name: "summary-trend", title: "Visitors and sessions" },
  { page: "/p/beacon", name: "summary-top-pages", title: "Top pages" },
  { page: "/p/beacon", name: "summary-channels", title: "Channels" },
  { page: "/p/beacon", name: "summary-countries", title: "Countries" },
  { page: "/p/beacon", name: "summary-devices", title: "Devices" },

  { page: "/p/beacon/funnels", name: "funnels-saved", title: "Saved funnels" },
  { page: "/p/beacon/funnels", name: "funnels-conversion", title: "Conversion" },
  { page: "/p/beacon/funnels", name: "funnels-dropoff", title: "Drop-off" },

  { page: "/p/beacon/paths", name: "paths-journeys", title: "Journeys" },
  { page: "/p/beacon/paths", name: "paths-entry", title: "Entry pages" },
  { page: "/p/beacon/paths", name: "paths-exit", title: "Exit pages" },

  { page: "/p/beacon/retention?by=week&range=90d", name: "retention-cohorts", title: "Cohort retention" },
  { page: "/p/beacon/retention?by=week&range=90d", name: "retention-stickiness", title: "Stickiness" },

  { page: "/p/beacon/events", name: "events-trend", title: "Events over time" },
  { page: "/p/beacon/events", name: "events-names", title: "Event names" },
  { page: "/p/beacon/events", name: "events-pages", title: "Pages by event volume" },
  { page: "/p/beacon/events", name: "events-sessions", title: "Sessions" },

  { page: "/p/beacon/crawlers", name: "ai-kpis", strip: 1, wait: "text=AI assistants" },
  { page: "/p/beacon/crawlers", name: "ai-assistants", title: "AI assistants" },
  { page: "/p/beacon/crawlers", name: "ai-referrals", title: "Traffic back from assistants" },
  { page: "/p/beacon/crawlers", name: "ai-reading", title: "What AI is reading" },
  { page: "/p/beacon/crawlers", name: "ai-by-purpose", title: "Every agent, by purpose" },

  { page: "/p/beacon/goals", name: "goals-kpis", strip: 1, wait: "text=Attribution" },
  { page: "/p/beacon/goals", name: "goals-list", title: "Goals" },
  { page: "/p/beacon/goals", name: "goals-revenue-trend", title: "Revenue over time" },
  { page: "/p/beacon/goals", name: "goals-attribution", title: "Attribution" },
  { page: "/p/beacon/goals", name: "goals-revenue-by-channel", title: "Revenue by channel" },

  { page: "/insights", name: "insights-cross-product", title: "People across products" },

  { page: "/alerts", name: "alerts-channels", title: "Delivery channels" },
  { page: "/alerts", name: "alerts-rules", title: "Alert rules" },
  { page: "/alerts", name: "alerts-firings", title: "Recent firings" },

  { page: "/settings", name: "settings-properties", title: "Properties" },
  { page: "/settings", name: "settings-endpoints", title: "Endpoints" },
  { page: "/settings/team", name: "team-members", title: "Members" },
  { page: "/settings/team", name: "team-invitations", title: "Pending invitations" },
  { page: "/settings/team", name: "team-roles", title: "What each role can do" },
  { page: "/settings/mcp", name: "mcp-connect", title: "Connect an assistant" },
  { page: "/settings/mcp", name: "mcp-keys", title: "API keys" },
  { page: "/p/beacon/settings", name: "install-snippet", title: "Install" },
  { page: "/p/beacon/settings", name: "public-link", title: "Public link" },
];

/** Panels on the person profile, whose URL is discovered at runtime. */
const PERSON_CARDS = [
  { name: "person-kpis", strip: 1 },
  { name: "person-timeline", title: "Timeline" },
  { name: "person-properties-used", title: "Properties used" },
  { name: "person-acquisition", title: "Acquisition chain" },
  { name: "person-identity", title: "Identity" },
  { name: "person-company", title: "Company" },
  { name: "person-interests", title: "Interests" },
  { name: "person-devices", title: "Devices and ids" },
  { name: "person-context", title: "Context" },
  { name: "person-first-touch", title: "First touch" },
];

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

/** Install the dev-chrome stylesheet into every document this context opens. */
async function hideDevChrome(context) {
  await context.addInitScript((css) => {
    const install = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head?.appendChild(style);
    };
    if (document.head) install();
    else document.addEventListener("DOMContentLoaded", install);
  }, HIDE_DEV_CHROME);
}

/** A section whose header carries this exact title — Card or ChartFrame. */
function panel(page, title) {
  return page
    .locator("section")
    .filter({ has: page.locator(`header >> text="${title}"`) })
    .first();
}

/** The nth direct child of the page body — used for the KPI strips. */
function bodyChild(page, index) {
  return page.locator(`.falorb-scroll > div > *:nth-child(${index})`).first();
}

async function settle(page, wait) {
  if (wait) {
    await page.locator(wait).first().waitFor({ state: "visible", timeout: 20_000 });
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  // Charts animate in; without this the bars are caught mid-transition and
  // every second run produces a visibly different image.
  await page.waitForTimeout(900);
}

/**
 * Push a burst of traffic while a live page is open.
 *
 * The event feed is a stream, not a query — it deliberately shows only what
 * arrives after the page opens, so seeding beforehand leaves it reading
 * "Waiting for events" no matter how much data exists. The only way to
 * photograph it working is to generate traffic while the shutter is open.
 */
async function pumpLive(page) {
  const root = resolve(import.meta.dirname, "../../..");
  const seed = (count, spread) =>
    run("pnpm", ["--filter", "@falorb/db", "seed:live"], {
      cwd: root,
      env: { ...process.env, SEED_LIVE_COUNT: String(count), SEED_LIVE_SPREAD_MS: String(spread) },
    });

  // The feed's empty state. Its absence is the only reliable signal that rows
  // have actually arrived — polling for that beats sleeping for a guessed
  // interval, because the delay is a race between a 3s server poll, the seed
  // process's own startup, and how long ClickHouse takes to make the rows
  // visible.
  const empty = page.locator("text=Waiting for events");

  try {
    // A wide burst fills the trailing window the "on site now" tiles read.
    await seed(90, 240_000);
    await page.waitForTimeout(3_000);

    /**
     * Reload before the tight bursts.
     *
     * The stream's cursor is set when the connection opens and only moves
     * forward. A connection opened before the wide burst has already consumed
     * (and advanced past) those rows, so the events that follow can land
     * behind it and never be sent. Reloading opens a fresh stream whose cursor
     * is "now", and everything pumped after it is unambiguously newer.
     */
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page, "text=On site now");

    // Then tight bursts, timestamped after the stream's cursor, until the feed
    // has rows. Each burst is small: this is meant to look like live traffic,
    // not like a stampede.
    for (let attempt = 0; attempt < 6; attempt++) {
      await seed(18, 1_200);
      await page.waitForTimeout(4_000);
      if ((await empty.count()) === 0) break;
    }

    // One more, so the feed has depth rather than a single row.
    await seed(18, 1_200);
    await page.waitForTimeout(4_500);

    if ((await empty.count()) > 0) {
      console.warn("  ! live feed still empty after pumping");
    }
  } catch (error) {
    console.warn(`  ! live pump: ${error.message.split("\n")[0]}`);
  }
}

/** Grow the viewport so the inner scroll container is fully visible. */
async function fitViewport(page) {
  const height = await page.evaluate(() => {
    const body = document.querySelector(".falorb-scroll > div");
    const chrome = document.querySelector("header");
    const content = body ? body.getBoundingClientRect().height : 0;
    const head = chrome ? chrome.getBoundingClientRect().height : 0;
    // The shell's own padding, plus a little breathing room at the bottom.
    return Math.ceil(content + head + 96);
  });

  const target = Math.min(Math.max(height, VIEWPORT_HEIGHT), MAX_HEIGHT);
  await page.setViewportSize({ width: WIDTH, height: target });
  await page.waitForTimeout(400);
}

async function shootPages(context, theme, pages, dir) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: VIEWPORT_HEIGHT });

  for (const spec of pages) {
    const file = `${OUT}/${dir}/${theme}/${spec.name}.png`;
    ensureDir(file);
    try {
      if (spec.workspace === "client") await selectWorkspace(page, 1);
      await page.goto(`${BASE}${spec.path}`, { waitUntil: "domcontentloaded" });
      await settle(page, spec.wait);
      await fitViewport(page);
      await page.screenshot({ path: file });
      console.log(`  ${theme}/${spec.name}`);
    } catch (error) {
      console.warn(`  ! ${theme}/${spec.name}: ${error.message.split("\n")[0]}`);
    }
    await page.setViewportSize({ width: WIDTH, height: VIEWPORT_HEIGHT });
    // Leave the active workspace as it was found, or every subsequent shot is
    // taken against the wrong tenant.
    if (spec.workspace === "client") await selectWorkspace(page, 0);
  }

  await page.close();
}

/**
 * Choose a workspace by its position in the switcher menu.
 *
 * The active workspace is stored per *account*, server-side — not in a cookie
 * — so it survives sign-out and leaks between runs. A previous session left on
 * the client workspace makes every `/p/<slug>` in this script 404, since a
 * slug is unique per organization. Every run therefore sets it explicitly
 * rather than assuming the default.
 */
async function selectWorkspace(page, index) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  const trigger = page.locator('button[aria-haspopup="menu"]:not([data-next-mark])');
  if ((await trigger.count()) === 0) return; // single-workspace account
  await trigger.click();

  const items = page.locator('[role="menuitem"]');
  await items.first().waitFor({ state: "visible", timeout: 5_000 });
  await items.nth(index).click();
  await page.waitForTimeout(1_500);
}

async function shootCards(context, theme) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: 1400 });

  // Group by page so each route is loaded once rather than once per card.
  const byPage = new Map();
  for (const card of CARDS) {
    const list = byPage.get(card.page) ?? [];
    list.push(card);
    byPage.set(card.page, list);
  }

  for (const [path, cards] of byPage) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await settle(page, cards.find((c) => c.wait)?.wait);
      if (cards.some((c) => c.live)) await pumpLive(page);
      await fitViewport(page);
    } catch (error) {
      console.warn(`  ! ${theme} ${path}: ${error.message.split("\n")[0]}`);
      continue;
    }

    for (const card of cards) {
      const file = `${OUT}/cards/${theme}/${card.name}.png`;
      ensureDir(file);
      try {
        const target = card.selector
          ? page.locator(card.selector).first()
          : card.strip
            ? bodyChild(page, card.strip)
            : panel(page, card.title);
        await target.waitFor({ state: "visible", timeout: 8_000 });
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        await target.screenshot({ path: file });
        console.log(`  ${theme}/cards/${card.name}`);
      } catch (error) {
        console.warn(`  ! ${theme}/cards/${card.name}: ${error.message.split("\n")[0]}`);
      }
    }
  }

  await page.close();
}

/**
 * The live screen, and everything on it.
 *
 * Runs after every other capture, and that ordering is not cosmetic. Filling
 * the live window means writing a few hundred events timestamped *now*, which
 * lands entirely in today's bucket — on a 30-day trend that is a spike on the
 * final point, and it inflates the session count and cross-product counts on
 * every screen shot afterwards. Doing it last confines the distortion to the
 * one screen whose subject is that traffic.
 */
async function shootLive(context, theme) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: 1400 });

  const cards = [
    { name: "live-kpis", selector: ".falorb-scroll > div > div > div:nth-child(1)" },
    { name: "live-feed", title: "Event feed" },
    { name: "live-pages", title: "Pages right now" },
    { name: "live-countries", title: "Countries right now" },
    { name: "live-longest", title: "Longest on site" },
  ];

  try {
    await page.goto(`${BASE}/p/beacon/live`, { waitUntil: "domcontentloaded" });
    await settle(page, "text=On site now");
    await pumpLive(page);
    await fitViewport(page);

    const full = `${OUT}/full/${theme}/03-live.png`;
    ensureDir(full);
    await page.screenshot({ path: full });
    console.log(`  ${theme}/03-live`);

    for (const card of cards) {
      const file = `${OUT}/cards/${theme}/${card.name}.png`;
      ensureDir(file);
      try {
        const target = card.selector
          ? page.locator(card.selector).first()
          : card.strip
            ? bodyChild(page, card.strip)
            : panel(page, card.title);
        await target.waitFor({ state: "visible", timeout: 6_000 });
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await target.screenshot({ path: file });
        console.log(`  ${theme}/cards/${card.name}`);
      } catch (error) {
        console.warn(`  ! ${theme}/cards/${card.name}: ${error.message.split("\n")[0]}`);
      }
    }
  } catch (error) {
    console.warn(`  ! ${theme} live: ${error.message.split("\n")[0]}`);
  }

  await page.close();
}

/** The workspace switcher, open — it only exists on multi-workspace accounts. */
async function shootSwitcher(context, theme) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: VIEWPORT_HEIGHT });

  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await settle(page, "text=Properties");

    // The trigger is the only button in the sidebar header.
    const trigger = page.locator('button[aria-haspopup="menu"]:not([data-next-mark])');
    await trigger.click();
    await page.locator('[role="menuitem"]').first().waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(400);

    const full = `${OUT}/full/${theme}/30-workspace-switcher.png`;
    ensureDir(full);
    await page.screenshot({ path: full });

    // Cropped to the sidebar, which is where the control actually lives.
    const card = `${OUT}/cards/${theme}/workspace-switcher.png`;
    ensureDir(card);
    await page.screenshot({ path: card, clip: { x: 0, y: 0, width: 320, height: 260 } });
    console.log(`  ${theme}/30-workspace-switcher`);
  } catch (error) {
    console.warn(`  ! ${theme} workspace switcher: ${error.message.split("\n")[0]}`);
  }

  await page.close();
}

async function shootPerson(context, theme) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: 1400 });

  try {
    await page.goto(`${BASE}/p/beacon/people`, { waitUntil: "domcontentloaded" });
    await settle(page, "text=Identified only");

    // The first row belonging to somebody with an email — an anonymous profile
    // makes a poor illustration of person-level detail.
    const row = page.locator('a[href^="/people/"]').filter({ hasText: "@" }).first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.click();
    await page.waitForURL(/\/people\//, { timeout: 15_000 });
    await settle(page, "text=Timeline");
    await fitViewport(page);

    const full = `${OUT}/full/${theme}/28-person-profile.png`;
    ensureDir(full);
    await page.screenshot({ path: full });
    console.log(`  ${theme}/28-person-profile`);

    for (const card of PERSON_CARDS) {
      const file = `${OUT}/cards/${theme}/${card.name}.png`;
      ensureDir(file);
      try {
        const target = card.selector
          ? page.locator(card.selector).first()
          : card.strip
            ? bodyChild(page, card.strip)
            : panel(page, card.title);
        await target.waitFor({ state: "visible", timeout: 6_000 });
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await target.screenshot({ path: file });
        console.log(`  ${theme}/cards/${card.name}`);
      } catch (error) {
        console.warn(`  ! ${theme}/cards/${card.name}: ${error.message.split("\n")[0]}`);
      }
    }
  } catch (error) {
    console.warn(`  ! ${theme} person profile: ${error.message.split("\n")[0]}`);
  }

  await page.close();
}

async function main() {
  // `SHOTS_ONLY=live` retakes just the live screen — the one capture that
  // depends on traffic generated while the page is open, and so the one most
  // likely to need a second attempt.
  const onlyLive = process.env.SHOTS_ONLY === "live";
  if (!onlyLive && existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

  const browser = await chromium.launch();
  const origin = new URL(BASE).origin;

  // Sign in once and reuse the cookies for every themed context.
  const signIn = await browser.newContext({ viewport: { width: WIDTH, height: VIEWPORT_HEIGHT } });
  const auth = await signIn.newPage();
  await auth.goto(`${BASE}/sign-in`);
  await auth.fill('input[name="email"]', EMAIL);
  await auth.fill('input[name="password"]', PASSWORD);
  await auth.click('button[type="submit"]');
  await auth.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });
  // Reset the account to its primary workspace before anything is captured.
  await selectWorkspace(auth, 0);

  const state = await signIn.storageState();
  await signIn.close();
  console.log(`signed in as ${EMAIL}`);

  const signedIn = async (theme) => {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: WIDTH, height: VIEWPORT_HEIGHT },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await context.addCookies([{ name: "falorb-theme", value: theme, url: origin }]);
    await hideDevChrome(context);
    return context;
  };

  for (const theme of onlyLive ? [] : THEMES) {
    console.log(`\n${theme}:`);

    const context = await signedIn(theme);
    await shootPages(context, theme, PAGES, "full");
    await shootSwitcher(context, theme);
    await shootPerson(context, theme);
    await shootCards(context, theme);
    await context.close();

    // Signed out, same theme.
    const anon = await browser.newContext({
      viewport: { width: WIDTH, height: VIEWPORT_HEIGHT },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await anon.addCookies([{ name: "falorb-theme", value: theme, url: origin }]);
    await hideDevChrome(anon);
    await shootPages(anon, theme, PUBLIC_PAGES, "full");
    await anon.close();
  }

  // Live last, for both themes — see the note on shootLive.
  for (const theme of THEMES) {
    console.log(`\n${theme} (live):`);
    const context = await signedIn(theme);
    await shootLive(context, theme);
    await context.close();
  }

  await browser.close();
  console.log(`\nwritten to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

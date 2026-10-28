// Helpers for browser checks with Playwright and Chromium (CLAUDE.md, "Before
// you commit"). Start the servers first (scripts/dev-servers.mjs), then write
// a small script next to your other scratch files:
//
//   import { open, press, measure } from "<repo>/scripts/browser.mjs";
//   const { page, problems, close } = await open(512);
//   await press(page, "text=Run query");
//   console.log(await measure(page, ".qb-block", (el) => el.getBoundingClientRect().height));
//   console.log(problems);
//   await close();
//
// Measure with `measure` / `page.evaluate` rather than screenshots where you
// can: a number answers "does it overlap?" for a fraction of what an image
// costs to look at. One screenshot per width is usually enough.
//
// Playwright is a dev dependency. Its browser is not: install it once per
// machine with `npx playwright install chromium`.
import { chromium } from "playwright";

export const APP = process.env.APP_URL ?? "http://localhost:5191";

/**
 * Opens the app logged in as the demo user, in a window `width` px wide.
 * `problems` collects console errors, page errors and failed requests as
 * they happen, so a check can end with "no new problems".
 */
export async function open(width, height = 900) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    // Expected answers, not problems: the login redirects, and 403 from
    // /log/status, which means "this session has no compliance log"
    // (ComplianceLogResponse in src/api/types.ts).
    const expected =
      /\/auth\//.test(response.url()) ||
      (response.status() === 403 && /\/log\/status$/.test(response.url()));
    if (response.status() >= 400 && !expected) {
      problems.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  await page.goto(`${APP}/api/v1/auth/login`);
  await page.click("text=Log in as demo.user");
  await page.waitForURL(`${APP}/**`);
  await page.waitForSelector(".qb-query");
  return { browser, page, problems, close: () => browser.close() };
}

/**
 * A realistic click: wait until the target stops moving, then press, wait
 * 100 ms and release. Playwright's own click() is too fast and hides bugs
 * that only show when a click follows typing.
 */
export async function press(page, target) {
  const element = typeof target === "string" ? page.locator(target).first() : target;
  await element.scrollIntoViewIfNeeded();
  let box = await element.boundingBox();
  for (let tries = 0; tries < 20; tries++) {
    await page.waitForTimeout(150);
    const next = await element.boundingBox();
    const still = box && next && Math.abs(next.x - box.x) < 1 && Math.abs(next.y - box.y) < 1;
    box = next;
    if (still) break;
  }
  if (!box) throw new Error(`press: ${String(target)} is not on screen`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** `read(element)` for every element matching `selector`, run in the page. */
export function measure(page, selector, read) {
  return page.$$eval(
    selector,
    (elements, source) => {
      const fn = new Function(`return (${source})`)();
      return elements.map((element) => fn(element));
    },
    read.toString(),
  );
}

/** Whether the page scrolls sideways (it never may, down to 512 px). */
export function scrollsSideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

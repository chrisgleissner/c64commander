/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Home's read-only values read as text, and no value is cut while its row still has room.
 *
 * Two rules, checked together on one page load each because they need the same expensive setup —
 * every card open — and the 90s per-test budget does not stretch to doing it twice.
 *
 * **No border.** "Single Color" against Pattern, "Indigo" against Color, "UltiSID1-A" against SID
 * Select are selects drawn as the value itself: no border, no background, no chevron. Every caller
 * puts `INLINE_SUMMARY_CONTROL_CLASS` on a `SelectTrigger` whose own base is `border border-input`,
 * so `border-0` in that string is the only thing turning the edge off. The appearance-token sweep
 * in 0.10.0-rc1 deleted it as redundant — true of a bare element, false of one whose base already
 * draws a border — and every value gained a 1px box with no padding inside it, so the text touched
 * the box and each row grew from 27px to 49.5px.
 *
 * **No cut value.** Four places cut text that had space beside it, all because a container fixed
 * its split before it knew what was in it: the SID shaping row gave three controls a third each, so
 * "Cap" read "470.." with the row half empty; a printer row let its value shrink to the touch floor
 * while the label kept its width; a drive's mounted line elided a sentence the way it elides a
 * path, so "No disk mounted" read "No d…". Ellipsis is right for a path, where the middle can go
 * and the name still identifies the file, and wrong for a value.
 *
 * `appearanceGeometryInvariance.spec.ts` cannot catch either: it compares one style against
 * another, and a border or a cut applied to every style equally is invariant.
 */
import { expect, test, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";

/** The Home cards whose rows carry inline value controls. Named, so nothing else is opened. */
const SECTIONS = ["cpu-ram", "ports", "video", "audio", "user-interface", "drives", "printers"];

/**
 * Two profiles, chosen as the extremes rather than swept.
 *
 * `medium` at 393px draws the narrowest track in the app — four columns of 69.6px — and the Large
 * text size is where a value first outgrows it. `compact` at 320px is the smallest screen. Between
 * them they bound every case the intermediate combinations sit inside.
 */
const VARIANTS = [
  { profile: "compact", width: 320, scale: "default" },
  { profile: "medium", width: 393, scale: "large" },
] as const;

const openInlineControlSections = async (page: Page) => {
  for (const id of SECTIONS) {
    const toggle = page.getByTestId(`home-section-toggle-${id}`);
    if ((await toggle.count()) === 0) continue;
    if ((await toggle.getAttribute("aria-expanded")) === "true") continue;
    await toggle.scrollIntoViewIfNeeded().catch(() => undefined);
    await toggle.click({ timeout: 3000 }).catch(() => undefined);
  }
  await page.waitForTimeout(500);
};

test.describe("Home inline value controls", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Inline control appearance only.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const variant of VARIANTS) {
    test(`read as text and keep every value whole on ${variant.profile} at ${variant.width}px, ${variant.scale} text @layout`, async ({
      page,
    }) => {
      await page.addInitScript(
        ({ profile, scale }) => {
          localStorage.setItem("c64u_display_profile_override", profile);
          localStorage.setItem("c64u_text_scale", scale);
        },
        { profile: variant.profile, scale: variant.scale },
      );
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.getByTestId("home-machine-controls").waitFor({ timeout: 30_000 });
      await openInlineControlSections(page);

      const report = await page.evaluate(() => {
        const root = document.querySelector('[data-slot-active="true"]') ?? document.body;
        const bordered: string[] = [];
        const clipped: string[] = [];
        let inlineCount = 0;

        for (const trigger of root.querySelectorAll<HTMLElement>('[role="combobox"]')) {
          // The inline treatment is the one that hides its chevron; a select meant to look like a
          // control keeps its chevron and is entitled to its border.
          const chevron = trigger.querySelector("svg");
          if (chevron === null || getComputedStyle(chevron).display !== "none") continue;
          inlineCount += 1;
          const width = Number.parseFloat(getComputedStyle(trigger).borderTopWidth);
          if (width > 0.01) {
            bordered.push(
              `${trigger.getAttribute("data-testid") ?? "(no testid)"} "${(trigger.textContent ?? "")
                .trim()
                .slice(0, 30)}" has a ${width}px border`,
            );
          }
        }

        for (const element of root.querySelectorAll<HTMLElement>("*")) {
          if (element.children.length > 0) continue;
          const style = getComputedStyle(element);
          if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
          if (element.scrollWidth - element.clientWidth <= 1) continue;
          const text = (element.textContent ?? "").trim();
          if (text.includes("/")) continue; // a path may be elided
          clipped.push(
            `${element.getAttribute("data-testid") ?? element.tagName} "${text.slice(0, 30)}" ` +
              `has ${element.clientWidth}px for ${element.scrollWidth}px of text`,
          );
        }

        return { bordered, clipped: [...new Set(clipped)], inlineCount };
      });

      // Guards the two assertions below against passing on a page that rendered nothing.
      expect(report.inlineCount, "Home must render inline value controls here").toBeGreaterThan(3);
      expect(report.bordered, report.bordered.join("\n")).toEqual([]);
      expect(report.clipped, report.clipped.join("\n")).toEqual([]);
    });
  }
});

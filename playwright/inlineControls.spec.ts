/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Home's read-only values read as text, not as form controls.
 *
 * "Single Color" against Pattern, "Indigo" against Color, "UltiSID1-A" against SID Select — these
 * are selects, but they are drawn as the value itself: no border, no background, no chevron. That
 * look is what `INLINE_SUMMARY_CONTROL_CLASS` is for.
 *
 * It is one Tailwind class away from being lost. Every caller puts that string on a `SelectTrigger`
 * whose own base class is `border border-input`, so `border-0` is the only thing turning the edge
 * off. The appearance-token sweep in 0.10.0-rc1 deleted it as redundant — true of a bare element,
 * false of one whose base already draws a border — and every one of these values gained a 1px box
 * with zero padding inside it, so the text touched the box and each row grew from 27px to 49.5px.
 *
 * `appearanceGeometryInvariance.spec.ts` did not catch it, and could not: it compares one style
 * against another, and a border added to every style equally is invariant. This measures the
 * rendered edge against the design intent instead.
 */
import { expect, test, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";

/** Home cards whose rows carry these inline value controls. */
const SECTIONS = ["cpu-ram", "ports", "video", "audio", "lighting", "drives", "printers"];

type Offender = { testId: string; text: string; border: string; height: number };

const openHomeSection = async (page: Page, id: string) => {
  const toggle = page.getByTestId(`home-section-toggle-${id}`);
  if ((await toggle.count()) === 0) return;
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click().catch(() => undefined);
  }
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

  test("draw no border, so a value reads as text rather than as an input @layout", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("home-machine-controls").waitFor({ timeout: 30_000 });
    for (const section of SECTIONS) await openHomeSection(page, section);
    await page.waitForTimeout(800);

    const offenders = await page.evaluate((): Offender[] => {
      const found: Offender[] = [];
      const root = document.querySelector('[data-slot-active="true"]') ?? document.body;
      for (const trigger of root.querySelectorAll<HTMLElement>('[role="combobox"]')) {
        // The inline treatment is the one that hides its chevron. A select meant to look like a
        // control keeps its chevron and is allowed its border.
        const chevron = trigger.querySelector("svg");
        const inline = chevron !== null && getComputedStyle(chevron).display === "none";
        if (!inline) continue;
        const style = getComputedStyle(trigger);
        const width = Number.parseFloat(style.borderTopWidth);
        if (width > 0.01) {
          found.push({
            testId: trigger.getAttribute("data-testid") ?? "(no testid)",
            text: (trigger.textContent ?? "").trim().slice(0, 32),
            border: `${style.borderTopWidth} ${style.borderTopColor}`,
            height: Number(trigger.getBoundingClientRect().height.toFixed(1)),
          });
        }
      }
      return found;
    });

    expect(
      offenders,
      offenders.map((o) => `${o.testId} "${o.text}" has a ${o.border} border, ${o.height}px tall`).join("\n"),
    ).toEqual([]);
  });

  /**
   * No value on Home is cut while the row it sits in still has room.
   *
   * Four separate places were cutting text that had space beside it, all for the same reason: a
   * container decided the split before it knew what was in it. The SID shaping row gave its three
   * controls one third each, so "Cap" read "470.." and "Digis" read "Med…" with the row half empty.
   * A printer row let its value shrink to the 44px floor while the label kept its width, so "US/UK"
   * lost a character. A drive's mounted line elided a sentence the way it elides a path, so "No disk
   * mounted" read "No d…".
   *
   * Ellipsis is right for a path, where the middle can go and the name still identifies the file.
   * It is wrong for a value or a sentence: "470.." names nothing. This sweeps the profile x Text
   * size matrix and reports anything clipped, so a container that sizes itself before it measures
   * its contents fails here rather than in a screenshot.
   */
  for (const variant of [
    { profile: "compact", width: 320, scale: "default" },
    { profile: "compact", width: 320, scale: "large" },
    { profile: "medium", width: 393, scale: "default" },
    { profile: "medium", width: 393, scale: "large" },
  ] as const) {
    test(`cut no value on ${variant.profile} at ${variant.width}px, ${variant.scale} text @layout`, async ({
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
      for (let round = 0; round < 3; round += 1) {
        const collapsed = await page.locator('[data-slot-active="true"] [aria-expanded="false"]').all();
        if (collapsed.length === 0) break;
        for (const toggle of collapsed.slice(0, 20)) await toggle.click({ timeout: 1500 }).catch(() => undefined);
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(600);

      const clipped = await page.evaluate(() => {
        const root = document.querySelector('[data-slot-active="true"]') ?? document.body;
        const found: string[] = [];
        for (const element of root.querySelectorAll<HTMLElement>("*")) {
          // Leaf nodes only: a scrollable ancestor is a different thing from cut text.
          if (element.children.length > 0) continue;
          const style = getComputedStyle(element);
          if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
          if (element.scrollWidth - element.clientWidth <= 1) continue;
          const text = (element.textContent ?? "").trim();
          // A path may be elided; that is what the treatment is for.
          if (text.includes("/")) continue;
          found.push(
            `${element.getAttribute("data-testid") ?? element.tagName} "${text.slice(0, 30)}" ` +
              `has ${element.clientWidth}px for ${element.scrollWidth}px of text`,
          );
        }
        return [...new Set(found)];
      });

      expect(clipped, clipped.join("\n")).toEqual([]);
    });
  }

  test("are still found, so the check above cannot pass on an empty page @layout", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("home-machine-controls").waitFor({ timeout: 30_000 });
    for (const section of SECTIONS) await openHomeSection(page, section);
    await page.waitForTimeout(800);

    const inlineCount = await page.evaluate(() => {
      const root = document.querySelector('[data-slot-active="true"]') ?? document.body;
      return [...root.querySelectorAll<HTMLElement>('[role="combobox"]')].filter((trigger) => {
        const chevron = trigger.querySelector("svg");
        return chevron !== null && getComputedStyle(chevron).display === "none";
      }).length;
    });

    expect(inlineCount, "Home must render inline value controls for the border check to mean anything").toBeGreaterThan(
      3,
    );
  });
});

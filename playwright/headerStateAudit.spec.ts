/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Every state the header can be in draws whole.
 *
 * The header is the one piece of chrome on every page, and it shares one row between a page title
 * it does not control and a badge whose width depends on the machine. That combination has now
 * produced three separate defects: a title wrapping onto a second line and being clamped, a host
 * label truncated to "192.168.1…", and — in 0.10.0-rc2 — a health circle drawn with its top and
 * both sides sliced off, because the glyph was a text character scaled past the box that clips it.
 *
 * Each of those was found by looking at a screenshot. This measures instead, over the states that
 * actually vary:
 *
 *   - the four display-profile viewports, which decide how much width the row has;
 *   - both Text sizes, which decide how much of it the words need;
 *   - all six pages, because the title is the half of the row the header does not choose;
 *   - the badge's health and connectivity states, which decide how wide the badge is;
 *   - light and dark.
 *
 * Appearance style is deliberately NOT swept here. `appearanceGeometryInvariance.spec.ts` proves
 * that switching style changes zero geometry across all twelve palettes, so a clipping defect
 * cannot be style-specific and sweeping styles would only multiply the runtime.
 *
 * Nothing here talks to real hardware. The device is `createMockC64Server`, and the health states
 * come from the same trace seed the screenshot corpus uses.
 */
import { expect, test, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { seedBadgeHealthTraceState } from "./visualSeeds";
import { DISPLAY_PROFILE_VIEWPORTS, DISPLAY_PROFILE_VIEWPORT_SEQUENCE } from "./displayProfileViewports";
import { applyDisplayProfileViewport } from "./displayProfileViewportUtils";
import { LARGEST_TEXT_SCALE_ID } from "../src/lib/textScale";

const PAGES = [
  { tab: "tab-home", path: "/", title: "Home" },
  { tab: "tab-play", path: "/play", title: "Play files" },
  { tab: "tab-disks", path: "/disks", title: "Disks" },
  { tab: "tab-config", path: "/config", title: "Config" },
  { tab: "tab-settings", path: "/settings", title: "Settings" },
  { tab: "tab-docs", path: "/docs", title: "Docs" },
] as const;

/** The badge contents that differ in width. 999+ is the widest the count can be. */
const BADGE_STATES = [
  { name: "healthy", health: "Healthy" as const, problemCount: 0 },
  { name: "degraded-12", health: "Degraded" as const, problemCount: 12 },
  { name: "degraded-999plus", health: "Degraded" as const, problemCount: 1808 },
  { name: "unhealthy-999plus", health: "Unhealthy" as const, problemCount: 1808 },
];

type HeaderDefect = { kind: string; where: string; detail: string };

/**
 * Measures the rendered header and reports anything drawn only in part.
 *
 * Runs in the page, so it is one self-contained function rather than imported helpers.
 */
const auditHeader = (page: Page): Promise<HeaderDefect[]> =>
  page.evaluate(() => {
    const defects: { kind: string; where: string; detail: string }[] = [];
    const header = document.querySelector("header");
    if (!header) return [{ kind: "missing-header", where: "header", detail: "no <header> on the page" }];

    const describe = (element: Element): string => {
      const testId = element.getAttribute("data-testid");
      if (testId) return `[${testId}]`;
      const text = (element.textContent ?? "").trim().slice(0, 24);
      const cls = element.className.toString().split(" ").slice(0, 2).join(".");
      return `${element.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
    };

    /** Screen-reader-only and deliberately-hidden nodes are not drawn, so they cannot be cut. */
    const isDrawn = (element: Element): boolean => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number.parseFloat(style.opacity) === 0) return false;
      if (element.classList.contains("sr-only")) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const elements = [...header.querySelectorAll<HTMLElement>("*")].filter(isDrawn);

    // 1. Text cut without an ellipsis to say so. `truncate` is a deliberate design here (the host
    //    label gives way before the page title does); a box that simply cuts its content is not.
    for (const element of elements) {
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (!ownText) continue;
      const style = getComputedStyle(element);
      const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
      const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
      const overX = element.scrollWidth - element.clientWidth;
      const overY = element.scrollHeight - element.clientHeight;
      if (clipsX && overX > 1 && style.textOverflow !== "ellipsis") {
        defects.push({
          kind: "text-cut-without-ellipsis",
          where: describe(element),
          detail: `"${ownText}" needs ${element.scrollWidth}px, box is ${element.clientWidth}px`,
        });
      }
      if (clipsY && overY > 1) {
        defects.push({
          kind: "text-cut-vertically",
          where: describe(element),
          detail: `"${ownText}" needs ${element.scrollHeight}px tall, box is ${element.clientHeight}px`,
        });
      }
      // 2. Truncated to nothing. "SETTIN…" carries meaning; a box too narrow for two characters
      //    plus the ellipsis does not.
      if (style.textOverflow === "ellipsis" && overX > 1 && element.clientWidth < 24) {
        defects.push({
          kind: "truncated-to-nothing",
          where: describe(element),
          detail: `"${ownText}" truncated into a ${element.clientWidth}px box`,
        });
      }
    }

    // 3. Anything drawn outside a clipping ancestor: the class of defect that cut the health
    //    circle. Applies to icons and shapes as much as to text.
    const headerRect = header.getBoundingClientRect();
    for (const element of elements) {
      if (getComputedStyle(element).position === "fixed") continue;
      const rect = element.getBoundingClientRect();
      for (let node = element.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
        const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
        if (clipsX || clipsY) {
          const clip = node.getBoundingClientRect();
          const over: Record<string, number> = {};
          if (clipsY) {
            over.top = clip.top - rect.top;
            over.bottom = rect.bottom - clip.bottom;
          }
          if (clipsX) {
            over.left = clip.left - rect.left;
            over.right = rect.right - clip.right;
          }
          for (const [side, amount] of Object.entries(over)) {
            if (amount > 0.5) {
              defects.push({
                kind: "cut-by-clipping-ancestor",
                where: describe(element),
                detail: `${describe(node)} cuts ${amount.toFixed(1)}px off the ${side}`,
              });
            }
          }
        }
        if (node === header) break;
      }
    }

    // 4. Nothing leaves the header's own box sideways: a row wider than the screen is a row with
    //    something on it the user cannot see.
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.right > headerRect.right + 0.5 || rect.left < headerRect.left - 0.5) {
        defects.push({
          kind: "outside-the-header",
          where: describe(element),
          detail: `spans ${rect.left.toFixed(1)}..${rect.right.toFixed(1)}, header is ${headerRect.left.toFixed(
            1,
          )}..${headerRect.right.toFixed(1)}`,
        });
      }
    }

    // 5. The two halves of the row do not overlap. Drawn on top of each other is the failure mode
    //    a width check alone does not see, because both boxes still fit.
    const titleZone = header.querySelector('[data-testid="app-bar-title-zone"]');
    const badge = header.querySelector('[data-testid="unified-health-badge"]');
    if (titleZone && badge) {
      const a = titleZone.getBoundingClientRect();
      const b = badge.getBoundingClientRect();
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (overlap > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) {
        defects.push({
          kind: "title-and-badge-overlap",
          where: "app-bar-row",
          detail: `${overlap.toFixed(1)}px of horizontal overlap`,
        });
      }
    }

    // 6. The badge always draws its shape, at a real size.
    const shape = header.querySelector("svg[data-health-shape]");
    if (!shape) {
      defects.push({ kind: "no-health-shape", where: "unified-health-badge", detail: "no shape drawn" });
    } else {
      const rect = shape.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) {
        defects.push({
          kind: "health-shape-too-small",
          where: "unified-health-badge",
          detail: `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
        });
      }
      if (Math.abs(rect.width - rect.height) > 1) {
        defects.push({
          kind: "health-shape-not-square",
          where: "unified-health-badge",
          detail: `${rect.width.toFixed(1)}x${rect.height.toFixed(1)} — a squashed box means a squashed shape`,
        });
      }
    }

    return defects;
  });

const waitForConnected = async (page: Page) => {
  await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connection-state",
    "REAL_CONNECTED",
    { timeout: 20_000 },
  );
};

const format = (context: string, defects: HeaderDefect[]) =>
  [`${context}: ${defects.length} header defect(s)`, ...defects.map((d) => `  ${d.kind} at ${d.where} — ${d.detail}`)]
    .join("\n")
    .trim();

test.describe("Header states are drawn whole", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Header geometry only; no traced user journey.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
    for (const scale of ["default", LARGEST_TEXT_SCALE_ID] as const) {
      test(`${profileId} viewport, ${scale} text, every page and badge state @layout`, async ({ page }) => {
        await page.addInitScript((id: string) => localStorage.setItem("c64u_text_scale", id), scale);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await applyDisplayProfileViewport(page, profileId);
        await waitForConnected(page);

        const allDefects: string[] = [];
        for (const target of PAGES) {
          await page.getByTestId(target.tab).click();
          await expect(page).toHaveURL(new RegExp(`${target.path === "/" ? "/$" : target.path + "$"}`));
          await page.waitForTimeout(250);

          for (const badge of BADGE_STATES) {
            await seedBadgeHealthTraceState(page, { health: badge.health, problemCount: badge.problemCount });
            await page.waitForTimeout(120);
            const defects = await auditHeader(page);
            if (defects.length > 0) {
              allDefects.push(format(`${profileId}/${scale} ${target.title} + ${badge.name}`, defects));
            }
          }
        }

        expect(allDefects, allDefects.join("\n\n")).toEqual([]);
      });
    }
  }

  test("dark mode draws the header the same way @layout", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await applyDisplayProfileViewport(page, "compact");
    await waitForConnected(page);

    const allDefects: string[] = [];
    for (const target of PAGES) {
      await page.getByTestId(target.tab).click();
      await page.waitForTimeout(250);
      await seedBadgeHealthTraceState(page, { health: "Unhealthy", problemCount: 1808 });
      await page.waitForTimeout(120);
      const defects = await auditHeader(page);
      if (defects.length > 0) allDefects.push(format(`dark ${target.title}`, defects));
    }
    expect(allDefects, allDefects.join("\n\n")).toEqual([]);
  });

  /**
   * The states no device produces: never connected, and a device that has gone away.
   *
   * The badge draws its Idle and Unavailable shapes here, and on the wider profiles it also draws
   * the words "Not connected" and "Offline", which is more text in the row than any connected
   * state puts there.
   */
  test("the disconnected header draws whole on every profile @layout", async ({ page }) => {
    for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
      const context = await page.context().newPage();
      try {
        // No mock server for this page, so the app never reaches a device.
        await context.goto("/", { waitUntil: "domcontentloaded" });
        await context.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profileId].viewport);
        await context.evaluate((override: string) => {
          localStorage.setItem("c64u_display_profile_override", override);
          window.dispatchEvent(
            new CustomEvent("c64u-ui-preferences-changed", { detail: { displayProfileOverride: override } }),
          );
        }, DISPLAY_PROFILE_VIEWPORTS[profileId].override);
        await context.locator("header").first().waitFor({ state: "visible", timeout: 30_000 });
        await context.waitForTimeout(1200);

        const defects = await auditHeader(context);
        expect(defects, format(`${profileId} disconnected`, defects)).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });
});

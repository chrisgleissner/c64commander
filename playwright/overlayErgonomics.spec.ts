/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { clickSourceSelectionButton } from "./sourceSelection";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { installLiveViewStreamStub } from "./liveViewStreamStub";

/**
 * Target sizes and readable labels on surfaces the tab-route sweep in `smallScreenErgonomics.spec.ts`
 * never reaches: menus, sheets and popups that only exist after a tap, the Live View stats that
 * only exist while frames flow, and the Large display profile chosen on a phone.
 * Each case here was measured on a 392 px wide phone before it was fixed.
 */

/** WCAG 2.5.5 target size, as in `smallScreenErgonomics.spec.ts`. */
const MIN_TARGET_PX = 44;

type Measured = { label: string; width: number; height: number };

/** The effective target of each element: its box, widened by a `hit-area-44` style `::before`. */
const measureTargets = (locator: Locator): Promise<Measured[]> =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const before = window.getComputedStyle(element, "::before");
      const pseudo = before.content !== "none" && before.position === "absolute";
      return {
        label: (element.getAttribute("data-testid") ?? element.getAttribute("aria-label") ?? element.textContent ?? "")
          .trim()
          .slice(0, 40),
        width: Math.round(Math.max(rect.width, pseudo ? Number.parseFloat(before.width) || 0 : 0) * 10) / 10,
        height: Math.round(Math.max(rect.height, pseudo ? Number.parseFloat(before.height) || 0 : 0) * 10) / 10,
      };
    }),
  );

/** Menus open with a 95% zoom-in, so a box measured mid-animation reads 43 px for a 44 px item. */
const waitForFiniteAnimations = (page: Page) =>
  page.evaluate(() =>
    // allSettled: an animation cancelled by a re-render rejects `finished`, and that is fine here.
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );

const expectAllMeetTarget = async (locator: Locator, what: string, minCount = 1) => {
  await waitForFiniteAnimations(locator.page());
  const measured = await measureTargets(locator);
  expect(measured.length, `${what}: nothing was measured`).toBeGreaterThanOrEqual(minCount);
  const undersized = measured.filter((m) => m.width < MIN_TARGET_PX - 0.5 || m.height < MIN_TARGET_PX - 0.5);
  expect(
    undersized.map((m) => `${m.width}x${m.height} ${m.label}`),
    `${what}: below the ${MIN_TARGET_PX}px target size`,
  ).toEqual([]);
};

const settle = async (page: Page, profile: string) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction((expected) => document.documentElement.dataset.displayProfile === expected, profile);
  await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);
};

const activeSlot = (page: Page) => page.locator('[data-slot-active="true"]');

const openSection = async (page: Page, toggleTestId: string) => {
  const toggle = activeSlot(page).getByTestId(toggleTestId);
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
};

const seedLists = async (page: Page) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const disks = Array.from({ length: 3 }, (_, index) => ({
      id: `ultimate:/Usb0/Disks/Disk-${index + 1}.d64`,
      name: `Disk-${index + 1}.d64`,
      path: `/Usb0/Disks/Disk-${index + 1}.d64`,
      location: "ultimate",
      group: null,
      importOrder: index + 1,
      importedAt: now,
      sizeBytes: 174_848,
      modifiedAt: now,
    }));
    localStorage.setItem("c64u_disk_library:TEST-123", JSON.stringify({ disks }));
    const items = Array.from({ length: 3 }, (_, index) => ({
      source: "ultimate",
      path: `/Usb0/Demos/Tune_${index + 1}.sid`,
      name: `Tune_${index + 1}.sid`,
      durationMs: 214_000,
      songNr: 1,
      sourceId: null,
    }));
    localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify({ items, currentIndex: 0 }));
  });
};

const openDiagnostics = async (page: Page) => {
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await settle(page, "medium");
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Diagnostics" });
  await expect(dialog).toBeVisible();
  return dialog;
};

const openOverflowEntry = async (page: Page, entryTestId: string) => {
  await page.getByRole("dialog", { name: "Diagnostics" }).getByTestId("diagnostics-overflow-menu").click();
  await page.getByTestId("diagnostics-overflow-panel").getByTestId(entryTestId).click();
};

test.describe("Overlay ergonomics on a phone", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "medium"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.medium.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("row action menu items on Disks and Play meet the target size", async ({ page }) => {
    await seedLists(page);
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    await settle(page, "medium");
    await activeSlot(page).getByTestId("disk-row").first().getByRole("button", { name: "Item actions" }).click();
    const diskMenu = page.getByRole("menu");
    await expect(diskMenu).toBeVisible();
    await expectAllMeetTarget(diskMenu.getByRole("menuitem"), "Disk row actions menu", 3);
    await page.keyboard.press("Escape");
    await expect(diskMenu).toBeHidden();

    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await settle(page, "medium");
    const playActions = activeSlot(page)
      .getByTestId("playlist-item")
      .first()
      .getByRole("button", { name: "Item actions" });
    const playMenu = page.getByRole("menu");
    // A row menu opened within a second of Play loading closes itself again; opened 5 s later it
    // stays open. That is a separate defect, so open it again until it stays rather than hide it.
    await expect(async () => {
      if (!(await playMenu.isVisible())) await playActions.click();
      await expect(playMenu).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expectAllMeetTarget(playMenu.getByRole("menuitem"), "Playlist row actions menu", 3);
  });

  test("diagnostics filter chips meet the target size and report their state", async ({ page }) => {
    const dialog = await openDiagnostics(page);
    await dialog.getByTestId("filters-collapsed-bar").click();
    const editor = page.getByTestId("filters-editor-surface");
    await expect(editor).toBeVisible();
    const chips = editor.locator("section button");
    await expectAllMeetTarget(chips, "Diagnostics filter chips", 4);
    // Types, contributors and severities are toggles, so each says whether it is on.
    expect(await editor.locator("section button[aria-pressed]").count()).toBeGreaterThanOrEqual(13);
  });

  test("analytic popup return button meets the target size", async ({ page }) => {
    await openDiagnostics(page);
    for (const entry of ["open-latency-screen", "open-timeline-screen"]) {
      await openOverflowEntry(page, entry);
      const back = page.getByTestId("analytic-popup-return");
      await expect(back).toBeVisible();
      await expectAllMeetTarget(back, `Return button (${entry})`);
      await back.click();
      await expect(back).toBeHidden();
    }
  });

  test("heat map metric toggles, cells and cell detail close meet the target size", async ({ page }) => {
    // Home issues the REST and config reads that give both heat maps cells to draw.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page, "medium");
    await page.waitForTimeout(1500);
    await openDiagnostics(page);
    for (const variant of ["rest", "config"]) {
      await openOverflowEntry(page, `open-${variant}-heatmap-screen`);
      const popup = page.getByTestId(`heat-map-popup-${variant}`);
      await expect(popup).toBeVisible();
      await expectAllMeetTarget(popup.locator('[data-testid^="heat-metric-"]'), `${variant} metric toggles`, 2);
      const cells = popup.locator('table [data-testid^="heat-cell-"] button:enabled');
      await expectAllMeetTarget(cells, `${variant} heat map cells`);
      // Keyboard, not a click: the first data column scrolls in under the sticky row labels.
      await cells.first().focus();
      await page.keyboard.press("Enter");
      const closeDetail = popup.getByRole("button", { name: "Close cell detail" });
      await expectAllMeetTarget(closeDetail, `${variant} cell detail`);
      await closeDetail.click();
      await expect(popup.getByTestId("heat-cell-detail")).toBeHidden();
      await page.getByTestId("analytic-popup-return").click();
      await expect(popup).toBeHidden();
    }
  });

  test("Live View stats toggle meets the target size while watching", async ({ page }) => {
    await installLiveViewStreamStub(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page, "medium");
    await openSection(page, "home-section-toggle-live-view");
    const liveView = activeSlot(page).getByTestId("live-view-card");
    await liveView.getByTestId("av-video-toggle").click();
    await expect(liveView.getByTestId("stream-stats")).toBeVisible({ timeout: 15_000 });
    await expectAllMeetTarget(liveView.getByTestId("stream-stats-toggle"), "Live View stats toggle");
  });
});

/**
 * A three-tune PSID whose header names a composer, so the now-playing card shows both links. The
 * name is long and there is no release line, so the composer link sits directly above the tunes
 * link and spans its column: a hit area grown downward from the composer, or upward from the tunes
 * link, lands on the other.
 */
const COMPOSER = "Jeroen Tel & Charles Deenen";

const writeComposerSid = (directory: string, flags: number) => {
  const bytes = Buffer.alloc(0x7c + 4, 0x60);
  bytes.fill(0, 0, 0x7c);
  bytes.write("PSID", 0, "latin1");
  bytes.writeUInt16BE(2, 0x04);
  bytes.writeUInt16BE(0x7c, 0x06);
  bytes.writeUInt16BE(0x1000, 0x08);
  bytes.writeUInt16BE(0x1000, 0x0a);
  bytes.writeUInt16BE(0x1003, 0x0c);
  bytes.writeUInt16BE(3, 0x0e);
  bytes.writeUInt16BE(1, 0x10);
  bytes.write("Composer Links", 0x16, "latin1");
  bytes.write(COMPOSER, 0x36, "latin1");
  bytes.writeUInt16BE(flags, 0x76);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "composer-links.sid"), bytes);
};

type HitReport = { width: number; height: number; takenBy: string[] };

/**
 * Hit-tests every pixel around a control. `width` and `height` are the longest unbroken horizontal
 * and vertical runs of points that land on the control, which is its reachable size whatever its
 * corner radius. `takenBy` names the other controls that a point inside the control's own box lands
 * on. A disabled control takes no pointer events, so a point on it falls through to whatever lies
 * beneath, and only another control there counts.
 */
const hitTestTarget = (locator: Locator): Promise<HitReport> =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const margin = 48;
    const left = Math.floor(rect.left - margin);
    const top = Math.floor(rect.top - margin);
    const columns = Math.ceil(rect.width + 2 * margin);
    const rows = Math.ceil(rect.height + 2 * margin);
    const owns = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    };
    const verticalRun = new Array<number>(columns).fill(0);
    let width = 0;
    let height = 0;
    for (let row = 0; row < rows; row += 1) {
      let horizontalRun = 0;
      for (let col = 0; col < columns; col += 1) {
        const owned = owns(left + col + 0.5, top + row + 0.5);
        horizontalRun = owned ? horizontalRun + 1 : 0;
        verticalRun[col] = owned ? verticalRun[col] + 1 : 0;
        width = Math.max(width, horizontalRun);
        height = Math.max(height, verticalRun[col]);
      }
    }
    const takenBy = new Set<string>();
    for (let y = Math.ceil(rect.top) + 0.5; y < rect.bottom; y += 1) {
      for (let x = Math.ceil(rect.left) + 0.5; x < rect.right; x += 1) {
        const control = document.elementFromPoint(x, y)?.closest("button, a[href], input, [role]");
        if (control && control !== element && !element.contains(control)) {
          takenBy.add(control.getAttribute("data-testid") ?? control.getAttribute("aria-label") ?? control.tagName);
        }
      }
    }
    return { width, height, takenBy: [...takenBy] };
  });

test.describe("Now playing links on a phone", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  // The header flags decide what precedes the tune position on the facts line. "6581 · PAL" leaves
  // it on the first line; "6581 or 8580 · PAL/NTSC" pushes it onto the second on a 320 px screen.
  const cases = [
    { profile: "compact", flags: 0x0014, tunesLine: 1 },
    { profile: "medium", flags: 0x0014, tunesLine: 1 },
    { profile: "compact", flags: 0x003c, tunesLine: 2 },
  ] as const;
  for (const { profile, flags, tunesLine } of cases) {
    test(`composer and tunes links have 44 px targets that take no taps from their neighbors (${profile}, tunes on facts line ${tunesLine})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript((override) => {
        localStorage.setItem("c64u_display_profile_override", override);
        localStorage.setItem("c64u_sid_radio_enabled", "1");
        localStorage.setItem("c64u_sid_ranking_enabled", "1");
      }, DISPLAY_PROFILE_VIEWPORTS[profile].override);
      await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profile].viewport);
      const folder = testInfo.outputPath("composer-links");
      writeComposerSid(folder, flags);

      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await settle(page, profile);
      await page.getByRole("button", { name: /Add items|Add more items/i }).click();
      await clickSourceSelectionButton(page.getByRole("dialog"), "This device");
      await page.locator('input[type="file"][webkitdirectory]').setInputFiles([folder]);
      await expect(page.getByRole("dialog")).toBeHidden();
      await activeSlot(page)
        .getByTestId("playlist-item")
        .filter({ hasText: "composer-links.sid" })
        .getByRole("button", { name: "Play" })
        .click();

      const card = activeSlot(page).getByTestId("playback-current-track");
      const composer = card.getByTestId("playback-current-composer");
      const tunes = card.getByTestId("playback-current-tunes");
      await expect(composer).toHaveText(COMPOSER, { timeout: 20_000 });
      await expect(tunes).toBeVisible();
      await expect(card.getByTestId("now-playing-ranking")).toBeVisible();
      // The "Items added" toast sits over the transport on a short screen and would answer for it.
      for (const close of await page.getByTestId("app-toast-close").all()) await close.click();
      await expect(page.getByTestId("app-toast-close")).toHaveCount(0);
      await card.scrollIntoViewIfNeeded();
      await waitForFiniteAnimations(page);
      const factsLineOfTunes = await tunes.evaluate((element) => {
        const facts = element.closest('[data-testid="playback-current-facts"]');
        const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
        const offset = element.getBoundingClientRect().top - (facts?.getBoundingClientRect().top ?? 0);
        return Math.round(offset / lineHeight) + 1;
      });
      expect(factsLineOfTunes, "facts line the tunes link wrapped onto").toBe(tunesLine);

      await expectAllMeetTarget(card.locator("button"), "Now playing card links and actions", 4);
      const composerCenter = await composer.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === element || element.contains(hit);
      });
      expect(composerCenter, "a tap at the composer's center reaches the composer").toBe(true);

      const neighbors = [
        composer,
        tunes,
        ...(await card.getByTestId("now-playing-ranking").getByRole("button").all()),
        ...(await activeSlot(page).getByTestId("playback-transport-row").getByRole("button").all()),
      ];
      for (const neighbor of neighbors) {
        const label = (await neighbor.getAttribute("data-testid")) ?? (await neighbor.getAttribute("aria-label"));
        const report = await hitTestTarget(neighbor);
        expect(report.takenBy, `${label}: controls that take taps inside its own box`).toEqual([]);
        if (await neighbor.isDisabled()) continue;
        expect(Math.min(report.width, report.height), `${label}: reachable size`).toBeGreaterThanOrEqual(
          MIN_TARGET_PX - 1,
        );
      }
    });
  }
});

test.describe("Large display chosen on a phone", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  const useLargeDisplay = async (
    page: Page,
    textScale: "default" | "large",
    viewport: "medium" | "expanded" = "medium",
  ) => {
    await page.addInitScript((scale) => {
      localStorage.setItem("c64u_display_profile_override", "expanded");
      localStorage.setItem("c64u_text_scale", scale);
    }, textScale);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[viewport].viewport);
  };

  test("SID address select keeps its full value at Large text", async ({ page }) => {
    await useLargeDisplay(page, "large");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page, "expanded");
    await openSection(page, "home-section-toggle-audio");
    const selects = activeSlot(page).locator('[data-testid^="home-sid-address-"]');
    await expect(selects.first()).toBeVisible();
    await expectAllMeetTarget(selects, "SID address selects", 2);
    const clipped = await selects.evaluateAll((triggers) =>
      triggers
        .map((trigger) => {
          const value = trigger.querySelector("span") ?? trigger;
          return {
            id: trigger.getAttribute("data-testid"),
            text: value.textContent,
            scrollWidth: value.scrollWidth,
            clientWidth: value.clientWidth,
          };
        })
        .filter((entry) => entry.scrollWidth > entry.clientWidth + 1),
    );
    expect(clipped, "SID address values cut short").toEqual([]);
  });

  /** The drawn (not screen-reader-only) title of a card header, and its rendered width. */
  const visibleTitle = (page: Page, toggleTestId: string) =>
    activeSlot(page)
      .getByTestId(toggleTestId)
      .locator("h2")
      .evaluate((heading) => {
        const drawn = Array.from(heading.querySelectorAll<HTMLElement>("span")).find(
          (span) => !span.classList.contains("sr-only") && span.children.length === 0,
        );
        const target = drawn ?? heading;
        const range = document.createRange();
        range.selectNodeContents(target);
        return {
          text: target.textContent ?? "",
          width: heading.getBoundingClientRect().width,
          needed: range.getBoundingClientRect().width,
        };
      });

  for (const textScale of ["default", "large"] as const) {
    test(`drive card titles stay readable at ${textScale} text`, async ({ page }) => {
      await useLargeDisplay(page, textScale);
      await page.goto("/disks", { waitUntil: "domcontentloaded" });
      await settle(page, "expanded");
      for (const key of ["a", "b"]) {
        const title = await visibleTitle(page, `disks-section-toggle-drive-${key}`);
        expect(title.text, `Disks drive ${key} title`).toBe(`Drive ${key.toUpperCase()}`);
        expect(title.width, `Disks drive ${key} title width`).toBeGreaterThanOrEqual(title.needed - 0.5);
      }

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page, "expanded");
      await openSection(page, "home-section-toggle-drives");
      for (const key of ["a", "b"]) {
        const title = await visibleTitle(page, `home-section-toggle-drive-${key}`);
        expect(title.text, `Home drive ${key} title`).toBe(`Drive ${key.toUpperCase()}`);
        expect(title.width, `Home drive ${key} title width`).toBeGreaterThanOrEqual(title.needed - 0.5);
      }
    });
  }

  test("drive card header keeps one row on a tablet", async ({ page }) => {
    await useLargeDisplay(page, "default", "expanded");
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    await settle(page, "expanded");
    const toggle = activeSlot(page).getByTestId("disks-section-toggle-drive-a");
    const power = activeSlot(page).getByTestId("drive-status-toggle-a");
    const [toggleBox, powerBox] = [await toggle.boundingBox(), await power.boundingBox()];
    expect(toggleBox && powerBox).toBeTruthy();
    const toggleMid = toggleBox!.y + toggleBox!.height / 2;
    expect(Math.abs(powerBox!.y + powerBox!.height / 2 - toggleMid), "ON/OFF sits beside the title").toBeLessThan(4);
    expect(powerBox!.x).toBeGreaterThan(toggleBox!.x + toggleBox!.width - 1);
  });
});

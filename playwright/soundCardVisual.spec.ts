/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { clickSourceSelectionButton } from "./sourceSelection";
import { installAudioFxMock, installLiveViewAudioStub, startPhoneSoundAndOpenPlay } from "./audioFxMock";
import { expectHandlesOnTheCurve, measureErgonomics, noHorizontalOverflow, settle } from "./audioFxLayout";

/**
 * The Sound card's look: the closed row, the open card in three ambiances, and the disabled card, at the
 * smallest and an ordinary phone width, light and dark. Asserts the geometry the design depends on.
 * SOUND_SHOTS_DIR, when set, also writes each picture there for a designer to look at.
 */

const SHOTS_DIR = process.env.SOUND_SHOTS_DIR;
const MAX_COLLAPSED_PX = 56;
const TALL_PX = 1700;
const AMBIANCES = ["warm", "late-night", "bright-arcade", "hall"] as const;

const keepShot = async (target: Locator, name: string) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), animations: "disabled" });
};

type Box = { left: number; right: number; top: number; bottom: number; text: string };

const boxes = (root: Locator, selector: string): Promise<Box[]> =>
  root.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        text: element.textContent ?? "",
      };
    }),
  );

const overlaps = (items: Box[], gap = 2): string[] => {
  const found: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      const apart =
        a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top;
      if (!apart) found.push(`"${a.text}" and "${b.text}"`);
    }
  }
  return found;
};

const open = async (page: Page, profile: "compact" | "medium", theme: "light" | "dark", tall: boolean) => {
  const { viewport, override } = DISPLAY_PROFILE_VIEWPORTS[profile];
  await page.setViewportSize(tall ? { width: viewport.width, height: TALL_PX } : viewport);
  await page.addInitScript(
    ({ value, mode }) => {
      localStorage.setItem("c64u_display_profile_override", value);
      localStorage.setItem("c64u_theme", mode);
    },
    { value: override, mode: theme },
  );
};

test.describe("Sound card look", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Visual layout of the Sound card with a mocked native plugin.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await installAudioFxMock(page);
    await installLiveViewAudioStub(page);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const profile of ["compact", "medium"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`closed, it is one calm row on ${profile} in the ${theme} theme @layout`, async ({ page }) => {
        await open(page, profile, theme, false);
        await page.goto("/play", { waitUntil: "domcontentloaded" });
        await settle(page, profile);
        const card = page.getByTestId("play-section-sound");
        await card.scrollIntoViewIfNeeded();
        await expect(card).toHaveAttribute("data-open", "false");
        const height = (await card.boundingBox())?.height ?? 0;
        expect(height, "The closed card is one row").toBeLessThanOrEqual(MAX_COLLAPSED_PX);
        for (const id of ["sound-accent-dot", "sound-active-name", "sound-switch", "play-section-chevron-sound"]) {
          await expect(card.getByTestId(id)).toBeVisible();
        }
        await expect(card.getByTestId("sound-active-name")).toHaveText("Original");
        await expect(card.getByTestId("sound-chip-row")).toHaveCount(0);
        await expect(card.getByTestId("sound-back")).toHaveCount(0);
        const measured = await measureErgonomics(card);
        expect(measured.textOffenders).toEqual([]);
        expect(measured.targetOffenders).toEqual([]);
        await keepShot(card, `collapsed-${profile}-${theme}`);
        await page.getByTestId("play-section-toggle-sound").click();
        await card.getByTestId("sound-chip-bright-arcade").click();
        await page.getByTestId("play-section-toggle-sound").click();
        await expect(card).toHaveAttribute("data-open", "false");
        await expect(card.getByTestId("sound-active-name")).toHaveText("Bright arcade");
        await expect
          .poll(async () => (await card.boundingBox())?.height ?? 0, { message: "A long name keeps one row" })
          .toBeLessThanOrEqual(MAX_COLLAPSED_PX);
        await card.getByTestId("sound-switch").click();
        await expect(card.getByTestId("sound-active-name")).toHaveText("Off");
        await keepShot(card, `collapsed-off-${profile}-${theme}`);
        await keepShot(page.getByTestId("play-section-spectrum").locator("xpath=.."), `context-${profile}-${theme}`);
      });

      test(`open, it takes each ambiance's color on ${profile} in the ${theme} theme @layout`, async ({ page }) => {
        test.setTimeout(90_000);
        await open(page, profile, theme, true);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await settle(page, profile);
        await startPhoneSoundAndOpenPlay(page);
        const card = page.getByTestId("play-section-sound");
        await page.getByTestId("play-section-toggle-sound").click();
        await expect(card.getByTestId("sound-body")).toBeVisible();
        const accents = new Set<string>();
        for (const ambiance of AMBIANCES) {
          await card.getByTestId(`sound-chip-${ambiance}`).click();
          await expect(card.getByTestId("sound-active-name")).toHaveText(
            await card.getByTestId(`sound-chip-${ambiance}`).innerText(),
          );
          await expect(card.getByTestId("sound-tone-spectrum")).toHaveCount(1);
          await page.waitForTimeout(400);
          accents.add(
            await card.getByTestId("sound-accent-dot").evaluate((element) => getComputedStyle(element).backgroundColor),
          );
          await expectHandlesOnTheCurve(page);
          await card.scrollIntoViewIfNeeded();
          await keepShot(card, `open-${ambiance}-${profile}-${theme}`);
        }
        expect(accents.size, "Every ambiance has its own accent").toBe(AMBIANCES.length);

        await noHorizontalOverflow(page);
        const measured = await measureErgonomics(card);
        expect(measured.textOffenders, "Text below 14 px").toEqual([]);
        expect(measured.targetOffenders, "Controls below 44 px").toEqual([]);
        const plot = await card.getByTestId("sound-tone-plot").boundingBox();
        expect(plot?.height ?? 0).toBeGreaterThanOrEqual(200);
        expect(
          overlaps(await boxes(card, '[data-testid^="sound-tone-axis-"]:not([data-hidden])'), 6),
          "Frequency labels",
        ).toEqual([]);
        for (const end of ["31", "16k"])
          await expect(card.getByTestId(`sound-tone-axis-${end}`)).not.toHaveAttribute("data-hidden");
        for (const slider of ["sound-stereo", "sound-reverb"]) {
          const root = card.getByTestId(slider);
          expect(overlaps(await boxes(root, '[data-testid*="-notch-"]'), 4), `${slider} notch labels`).toEqual([]);
          const header = await boxes(root, `[data-testid="${slider}-label"], [data-testid="${slider}-readout"]`);
          expect(overlaps(header, 4), `${slider} readout`).toEqual([]);
        }
      });
    }
  }

  for (const theme of ["light", "dark"] as const) {
    test(`a drag shows the band's value above its handle on compact in the ${theme} theme @layout`, async ({
      page,
    }) => {
      await open(page, "compact", theme, true);
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await settle(page, "compact");
      const card = page.getByTestId("play-section-sound");
      await page.getByTestId("play-section-toggle-sound").click();
      await card.getByTestId("sound-tone-preset-loudness").click();
      const plot = card.getByTestId("sound-tone-plot");
      await plot.scrollIntoViewIfNeeded();
      await expect(card.getByTestId("sound-tone-preset-loudness")).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(500);
      const point = await card.getByTestId("sound-tone-point-6").boundingBox();
      const area = await card.getByTestId("sound-tone-area").boundingBox();
      if (!point || !area) throw new Error("The tone plot has no geometry");
      const x = point.x + point.width / 2;
      await page.mouse.move(x, point.y + point.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, area.y + area.height * 0.3, { steps: 4 });
      await expect(card.getByTestId("sound-tone-bubble")).toBeVisible();
      await expect(card.getByTestId("sound-tone-guide")).toBeVisible();
      await expectHandlesOnTheCurve(page);
      await keepShot(plot, `drag-compact-${theme}`);
      await page.mouse.up();
      await expect(card.getByTestId("sound-tone-bubble")).toHaveCount(0);
    });

    test(`disabled, it says why and greys out on compact in the ${theme} theme @layout`, async ({ page }) => {
      await open(page, "compact", theme, true);
      await page.addInitScript(() => localStorage.setItem("c64u_feature_flag:audio_mirror_enabled", "0"));
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await settle(page, "compact");
      await page.getByRole("button", { name: /Add items|Add more items/i }).click();
      await clickSourceSelectionButton(page.getByRole("dialog"), "This device");
      await page
        .locator('input[type="file"][webkitdirectory]')
        .setInputFiles([path.resolve("playwright/fixtures/local-play")]);
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.getByTestId("playlist-play").click();
      const card = page.getByTestId("play-section-sound");
      await expect(card.getByTestId("sound-switch")).toBeDisabled();
      await page.getByTestId("play-section-toggle-sound").click();
      await expect(card.getByTestId("sound-unavailable")).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await keepShot(card, `disabled-compact-${theme}`);
    });
  }
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over REST
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS, type DisplayProfileViewportId } from "./displayProfileViewports";
import { enableKeypad, KEY_SELECTED_ATTRIBUTE, ringFocus } from "./focusRing";
import { installAudioFxMock } from "./audioFxMock";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "../src/pages/playFiles/playFilesUtils";

const isOnScreen = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
  });

const startPlayPage = async (
  page: Page,
  serverBaseUrl: string,
  mode: "regular" | "sid-player",
  profile: "compact" | "medium",
  populated = false,
) => {
  const items = populated
    ? [
        {
          source: "hvsc",
          path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
          name: "Commando.sid",
          durationMs: 120_000,
          songNr: 1,
        },
      ]
    : [];
  await seedUiMocks(page, serverBaseUrl);
  await enableKeypad(page);
  await installAudioFxMock(page);
  await page.addInitScript(
    ({ mode: modeArg, profile: profileArg, playlistKey, sessionKey, items: playlistItems }) => {
      localStorage.setItem("c64u_display_profile_override", profileArg);
      if (modeArg === "sid-player") localStorage.setItem("c64u_startup_mode", modeArg);
      else localStorage.removeItem("c64u_startup_mode");
      const payload = JSON.stringify({ items: playlistItems, currentIndex: playlistItems.length ? 0 : null });
      localStorage.setItem(playlistKey, payload);
      localStorage.setItem("c64u_playlist:v1:default", payload);
      if (playlistItems.length) {
        sessionStorage.setItem(
          sessionKey,
          JSON.stringify({
            playlistKey,
            currentItemId: null,
            currentItemLabel: playlistItems[0].name,
            currentIndex: 0,
            isPlaying: false,
            isPaused: false,
            elapsedMs: 0,
            playedMs: 0,
            durationMs: playlistItems[0].durationMs,
            autoAdvanceDueAtMs: null,
            shuffleEnabled: false,
            repeatEnabled: false,
            randomSeed: 1,
            updatedAt: new Date().toISOString(),
          }),
        );
      }
    },
    {
      mode,
      profile: DISPLAY_PROFILE_VIEWPORTS[profile].override,
      playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
      sessionKey: PLAYBACK_SESSION_KEY,
      items,
    },
  );
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profile].viewport);
  await page.goto("/play", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("play-section-playback-settings")).toBeVisible();
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile !== undefined);
};

const configurations = [
  { mode: "regular", profile: "compact" },
  { mode: "regular", profile: "medium" },
  { mode: "sid-player", profile: "compact" },
  { mode: "sid-player", profile: "medium" },
] as const;

test.describe("Play page keyboard reachability", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page: _page }, testInfo) => {
    disableTraceAssertions(testInfo, "Play page keyboard navigation; trace assertions disabled.");
    server = await createMockC64Server({});
  });

  test.afterEach(async () => server.close());

  for (const { mode, profile } of configurations) {
    test(`${mode} on ${profile}: keyboard reaches settings and continues to the cards below`, async ({ page }) => {
      await startPlayPage(page, server.baseUrl, mode, profile);

      const settings = page.getByTestId("play-section-playback-settings");
      const settingsToggle = settings.locator("button[aria-expanded]").first();
      const sleepTimerOff = page.getByTestId("sleep-timer-off");
      const sleepTimer15 = page.getByTestId("sleep-timer-m15");
      const durationSlider = page.getByTestId("duration-slider").getByRole("slider");
      const durationInput = page.getByTestId("duration-input");
      const change = page.getByRole("button", { name: "Change songlengths file", exact: true });
      const spectrum = page.getByTestId("play-section-spectrum");
      const sound = page.getByTestId("play-section-sound");
      const soundToggle = sound.locator("button[aria-expanded]").first();

      expect(await ringFocus(page, settings), "the keyboard could not reach Playback settings").toBe(true);
      await page.keyboard.press("Enter");
      await expect(settings).toHaveAttribute("data-open", "true");
      expect(await ringFocus(page, sleepTimer15), "the keyboard could not reach the 15 minute sleep timer").toBe(true);
      await expect(sleepTimer15).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(sleepTimer15).toHaveAttribute("aria-pressed", "true");
      expect(await ringFocus(page, sleepTimerOff), "the keyboard could not reach Sleep timer Off").toBe(true);
      await page.keyboard.press("Enter");
      await expect(sleepTimerOff).toHaveAttribute("aria-pressed", "true");

      expect(await ringFocus(page, durationSlider), "the keyboard could not reach Default duration slider").toBe(true);
      const sliderValueBeforeKey = await durationSlider.getAttribute("aria-valuenow");
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => durationSlider.getAttribute("aria-valuenow")).not.toBe(sliderValueBeforeKey);
      for (const [target, description] of [
        [durationSlider, "Default duration slider"],
        [durationInput, "Default duration override"],
        [change, "Change songlengths file"],
      ] as const) {
        expect(await ringFocus(page, target), `the keyboard could not reach ${description}`).toBe(true);
        await expect(target).toBeInViewport();
      }
      await expect(change).toHaveAttribute(KEY_SELECTED_ATTRIBUTE, "true");
      await expect(change).toBeInViewport();

      // Touch and keys both control the new settings card; reopening restores its controls.
      await settingsToggle.tap();
      await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
      await expect(change).toBeHidden();
      await settingsToggle.tap();
      await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
      await expect(change).toBeVisible();
      expect(await ringFocus(page, change), "the reopened settings controls did not return to the focus ring").toBe(
        true,
      );

      // A section is an intentional focus scope. Back returns to its header; the next Down
      // reaches the next card in page order without a pointer or DOM focus call.
      await page.keyboard.press("Escape");
      await expect(settings).toHaveAttribute(KEY_SELECTED_ATTRIBUTE, "true");
      await page.keyboard.press("ArrowDown");
      await expect(spectrum).toHaveAttribute(KEY_SELECTED_ATTRIBUTE, "true");
      await expect(spectrum).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(spectrum).toHaveAttribute("data-open", "true");
      await expect(page.getByTestId("spectrum-panel")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowDown");
      await expect(sound).toHaveAttribute(KEY_SELECTED_ATTRIBUTE, "true");
      await expect(sound).toBeInViewport();
      // The Sound card has an independent processing switch beside its collapse button.
      // Walk to the actual toggle before pressing OK; on SID Player the switch is enabled
      // and can be the first action discovered within the card's focus scope.
      if (mode === "sid-player") {
        expect(await ringFocus(page, soundToggle), "the Sound card toggle was not keyboard reachable").toBe(true);
      }
      await page.keyboard.press("Enter");
      await expect(soundToggle).toHaveAttribute("aria-expanded", "true");
      await expect(sound).toHaveAttribute("data-open", "true");

      // Back then Up traverses the same cards in the reverse direction.
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowUp");
      await expect(spectrum).toHaveAttribute(KEY_SELECTED_ATTRIBUTE, "true");
    });
  }
});

test.describe("Play page Playlist collapsible card", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page: _page }, testInfo) => {
    disableTraceAssertions(testInfo, "Playlist section behavior; trace assertions disabled.");
    server = await createMockC64Server({});
  });

  test.afterEach(async () => server.close());

  for (const { mode, profile } of configurations) {
    for (const populated of [false, true]) {
      test(`${mode} on ${profile}: ${populated ? "populated" : "empty"} playlist collapses by keys and touch`, async ({
        page,
      }) => {
        await startPlayPage(page, server.baseUrl, mode, profile, populated);

        const playlist = page.getByTestId("play-section-playlist");
        const toggle = playlist.locator("button[aria-expanded]").first();
        const addItems = page.getByTestId("add-items-to-playlist");
        expect(await ringFocus(page, playlist), "the keyboard could not reach the Playlist card").toBe(true);
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(addItems).toBeVisible();
        await expect(page.getByTestId("playlist-list")).toBeVisible();
        await expect(playlist.getByRole("heading", { name: "Playlist", exact: true })).toHaveCount(1);
        if (populated) {
          await expect(page.getByTestId("playlist-item")).toHaveCount(1);
          await expect(page.getByRole("button", { name: "Clear playlist" })).toBeVisible();
        } else {
          await expect(page.getByText("No tracks in playlist yet.")).toBeVisible();
        }

        expect(await ringFocus(page, addItems), "Add items was not reachable after opening Playlist").toBe(true);
        await page.keyboard.press("Escape");
        await expect(playlist).toHaveAttribute(KEY_SELECTED_ATTRIBUTE, "true");
        expect(await ringFocus(page, toggle), "the Playlist collapse control was not keyboard reachable").toBe(true);
        await page.keyboard.press("Enter");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(addItems).toBeHidden();
        expect(
          await playlist.evaluate((section) => {
            const bodyId = section.querySelector("button[aria-controls]")?.getAttribute("aria-controls");
            const body = bodyId ? document.getElementById(bodyId) : null;
            const selected = document.querySelector('[data-key-selected="true"]');
            return !body || !selected || !body.contains(selected);
          }),
          "a hidden Playlist control remained selected after collapse",
        ).toBe(true);

        // Touch continues to operate the same section header. Reopening restores the existing queue.
        await toggle.tap();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(addItems).toBeVisible();
        expect(await ringFocus(page, addItems), "hidden Playlist controls did not return to the focus ring").toBe(true);
        if (populated) await expect(page.getByTestId("playlist-item")).toHaveCount(1);
        await expect(page.getByTestId("play-section-playback")).toBeVisible();

        // The shared section store keeps this card's choice when the Play page is remounted.
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("c64u_open_sections") ?? "{}"));
        expect(saved["play:playlist"]).toBe(true);
        await page.reload();
        await expect(page.getByTestId("play-section-playlist")).toHaveAttribute("data-open", "true");

        // Page-wide actions include the new card and remain reachable from the Quick menu.
        await page.getByTestId("app-bar-quick-menu").tap();
        const expandAll = page.getByTestId("keypad-quick-menu-sections-expand");
        await expect(expandAll).toBeVisible();
        await expandAll.tap();
        for (const testId of [
          "play-section-playlist",
          "play-section-playback-settings",
          "play-section-spectrum",
          "play-section-sound",
        ]) {
          await expect(page.getByTestId(testId)).toHaveAttribute("data-open", "true");
        }
        await page.getByTestId("app-bar-quick-menu").tap();
        await page.getByTestId("keypad-quick-menu-sections-collapse").tap();
        for (const testId of [
          "play-section-playlist",
          "play-section-playback-settings",
          "play-section-spectrum",
          "play-section-sound",
        ]) {
          await expect(page.getByTestId(testId)).toHaveAttribute("data-open", "false");
        }
      });
    }
  }
});

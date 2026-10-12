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
import { enableKeypad, ringFocus } from "./focusRing";
import {
  audioFxCalls,
  installAudioFxMock,
  installLiveViewAudioStub,
  setAudioFxClipped,
  startPhoneSoundAndOpenPlay,
} from "./audioFxMock";

/**
 * The Spectrum card on Play and the Audio processing section in Settings, against a mocked native
 * plugin. The plugin does not exist in a browser, so the app's test-probe hook supplies one.
 *
 * AUDIO_FX_SHOTS_DIR, when set, also writes the screenshots to that directory for a human to look at.
 */

const MIN_TEXT_PX = 14;
const MIN_BODY_TEXT_PX = 16;
const MIN_TARGET_PX = 44;

const SHOTS_DIR = process.env.AUDIO_FX_SHOTS_DIR;

const keepShot = async (target: Locator | Page, name: string) => {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
};

const settle = async (page: Page, profile: string) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction((expected) => document.documentElement.dataset.displayProfile === expected, profile);
  await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-slot-active="true"] [data-page-scroll-container]').waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
};

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "The page scrolls horizontally").toBeLessThanOrEqual(1);
};

/** Text and controls inside `root` that are smaller than the floors the app holds every screen to. */
const measureErgonomics = (root: Locator) =>
  root.evaluate(
    (element, floors) => {
      const textOffenders: string[] = [];
      const bodyOffenders: string[] = [];
      const targetOffenders: string[] = [];
      let textCount = 0;
      let targetCount = 0;
      for (const node of Array.from(element.querySelectorAll<HTMLElement>("*"))) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const own = Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent ?? "")
          .join("")
          .trim();
        const rect = node.getBoundingClientRect();
        if (own && rect.width > 0 && rect.height > 0) {
          textCount += 1;
          const px = Number.parseFloat(style.fontSize);
          if (px < floors.text) textOffenders.push(`${px}px "${own.slice(0, 30)}"`);
          if (
            node.tagName === "P" &&
            own.length >= 12 &&
            node.dataset.testid !== "spectrum-message" &&
            px < floors.body
          )
            bodyOffenders.push(`${px}px "${own.slice(0, 30)}"`);
          if (node.dataset.testid === "spectrum-message" && px < floors.body) bodyOffenders.push(`${px}px message`);
        }
        const isControl =
          node.matches('button, input, [role="switch"], [role="button"]') && !(node as HTMLButtonElement).disabled;
        if (isControl && rect.width > 0 && rect.height > 0) {
          targetCount += 1;
          const label = node.closest("label") ?? (node.id ? document.querySelector(`label[for="${node.id}"]`) : null);
          const labelRect = label?.getBoundingClientRect();
          const width = Math.max(rect.width, labelRect?.width ?? 0);
          const height = Math.max(rect.height, labelRect?.height ?? 0);
          const before = getComputedStyle(node, "::before");
          const hit = before.content !== "none" && before.position === "absolute";
          const w = hit ? Math.max(width, Number.parseFloat(before.width) || 0) : width;
          const h = hit ? Math.max(height, Number.parseFloat(before.height) || 0) : height;
          if (w < floors.target || h < floors.target)
            targetOffenders.push(`${Math.round(w)}x${Math.round(h)} ${node.dataset.testid ?? node.tagName}`);
        }
      }
      return { textOffenders, bodyOffenders, targetOffenders, textCount, targetCount };
    },
    { text: MIN_TEXT_PX, body: MIN_BODY_TEXT_PX, target: MIN_TARGET_PX },
  );

/** How many pixels in the canvas differ from its top-left background colour: zero means nothing was drawn. */
const drawnPixels = (canvas: Locator) =>
  canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const probe = document.createElement("canvas");
    probe.width = source.width;
    probe.height = source.height;
    const ctx = probe.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    const base = [data[0], data[1], data[2]];
    let differing = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - base[0]) + Math.abs(data[i + 1] - base[1]) + Math.abs(data[i + 2] - base[2]) > 60)
        differing += 1;
    }
    return { differing, total: data.length / 4 };
  });

const profiles = [
  { id: "compact", ...DISPLAY_PROFILE_VIEWPORTS.compact },
  { id: "expanded", ...DISPLAY_PROFILE_VIEWPORTS.expanded },
] as const;

test.describe("Spectrum card and audio processing", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout coverage with a mocked native plugin; trace assertions disabled.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const { profile, theme } of profiles.flatMap((profile) =>
    (["light", "dark"] as const).map((theme) => ({ profile, theme })),
  )) {
    test(`the spectrum is drawn, readable and bounded on ${profile.id} in the ${theme} theme @layout`, async ({
      page,
    }) => {
      await installAudioFxMock(page);
      await installLiveViewAudioStub(page);
      await page.addInitScript((value) => localStorage.setItem("c64u_theme", value), theme);
      await page.addInitScript(
        (override) => localStorage.setItem("c64u_display_profile_override", override),
        profile.override,
      );
      await page.setViewportSize(profile.viewport);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page, profile.id);
      await startPhoneSoundAndOpenPlay(page);

      const card = page.getByTestId("play-section-spectrum");
      await expect(card).toBeVisible();
      if ((await card.getAttribute("data-open")) !== "true")
        await page.getByTestId("play-section-toggle-spectrum").click();
      const canvas = page.getByTestId("spectrum-canvas");
      await expect(canvas).toBeVisible();
      await expect.poll(async () => (await drawnPixels(canvas)).differing, { timeout: 10_000 }).toBeGreaterThan(400);
      await expect(page.getByTestId("spectrum-message")).toHaveCount(0);
      await expect(page.getByTestId("spectrum-rms")).not.toHaveText("");
      await expect(page.getByTestId("spectrum-peak")).not.toHaveText("");

      await noHorizontalOverflow(page);
      const box = await canvas.boundingBox();
      expect(box!.width).toBeGreaterThan(profile.id === "compact" ? 250 : 600);
      const measured = await measureErgonomics(card);
      expect(measured.textCount).toBeGreaterThan(4);
      expect(measured.textOffenders, "Text below the size floor").toEqual([]);
      expect(measured.bodyOffenders, "Body text below the size floor").toEqual([]);
      expect(measured.targetOffenders, "Controls below the target size").toEqual([]);

      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      await keepShot(card, `spectrum-${profile.id}-${theme}`);
      await keepShot(page, `spectrum-${profile.id}-${theme}-page`);
    });
  }

  test("collapsing the card switches the analyser off and opening it switches it on", async ({ page }) => {
    await installAudioFxMock(page);
    await installLiveViewAudioStub(page);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page, "compact");
    await startPhoneSoundAndOpenPlay(page);

    const toggle = page.getByTestId("play-section-toggle-spectrum");
    const card = page.getByTestId("play-section-spectrum");
    if ((await card.getAttribute("data-open")) !== "true") await toggle.click();
    await expect(page.getByTestId("spectrum-canvas")).toBeVisible();
    await expect
      .poll(async () => (await audioFxCalls(page)).filter((c) => c.method === "setSpectrumEnabled").pop())
      .toEqual({ method: "setSpectrumEnabled", enabled: true });

    await toggle.click();
    await expect(page.getByTestId("spectrum-canvas")).toHaveCount(0);
    await expect
      .poll(async () => (await audioFxCalls(page)).filter((c) => c.method === "setSpectrumEnabled").pop())
      .toEqual({ method: "setSpectrumEnabled", enabled: false });
  });

  test("it says what is needed when no sound is playing on the phone", async ({ page }) => {
    await installAudioFxMock(page);
    await installLiveViewAudioStub(page);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await settle(page, "compact");
    if ((await page.getByTestId("play-section-spectrum").getAttribute("data-open")) !== "true")
      await page.getByTestId("play-section-toggle-spectrum").click();
    await expect(page.getByTestId("spectrum-message")).toHaveText(
      "Spectrum is available for sound played on this phone",
    );
    const measured = await measureErgonomics(page.getByTestId("play-section-spectrum"));
    expect(measured.bodyOffenders).toEqual([]);
    await keepShot(page.getByTestId("play-section-spectrum"), "spectrum-compact-idle");
    expect((await audioFxCalls(page)).filter((c) => c.method === "setSpectrumEnabled" && c.enabled)).toEqual([]);

    await page.getByTestId("tab-home").click();
    await startPhoneSoundAndOpenPlay(page);
    await expect(page.getByTestId("spectrum-message")).toHaveCount(0, { timeout: 5000 });
  });

  test("the clip lamp lights while the plugin reports clipping and releases afterwards", async ({ page }) => {
    await installAudioFxMock(page);
    await installLiveViewAudioStub(page);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page, "compact");
    await startPhoneSoundAndOpenPlay(page);
    if ((await page.getByTestId("play-section-spectrum").getAttribute("data-open")) !== "true")
      await page.getByTestId("play-section-toggle-spectrum").click();
    const lamp = page.getByTestId("spectrum-clip");
    await expect(lamp).toHaveAttribute("data-clipping", "false");
    await setAudioFxClipped(page, true);
    await expect(lamp).toHaveAttribute("data-clipping", "true");
    await keepShot(page.getByTestId("play-section-spectrum"), "spectrum-compact-clip");
    await setAudioFxClipped(page, false);
    await expect(lamp).toHaveAttribute("data-clipping", "false", { timeout: 5000 });
  });

  test("the card and the settings section are absent when the phone cannot process sound", async ({ page }) => {
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await settle(page, "compact");
    await expect(page.getByTestId("play-section-spectrum")).toHaveCount(0);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await settle(page, "compact");
    await expect(page.getByTestId("settings-audio-processing")).toHaveCount(0);
  });

  test("audio processing settings reach the plugin and stay off by default @layout", async ({ page }) => {
    await installAudioFxMock(page);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await settle(page, "compact");

    const section = page.getByTestId("settings-audio-processing");
    await expect(section).toBeVisible();
    if ((await section.getAttribute("data-open")) !== "true")
      await page.getByTestId("settings-section-toggle-audio-processing").click();

    await expect
      .poll(async () => (await audioFxCalls(page)).filter((c) => c.method === "setAudioProcessing").pop())
      .toEqual({
        method: "setAudioProcessing",
        params: { levelling: false, bassDb: 0, midDb: 0, trebleDb: 0, stereoWidth: 0, reverb: 0 },
      });

    await page.getByTestId("settings-audio-levelling").scrollIntoViewIfNeeded();
    await page.getByTestId("settings-audio-levelling").click();
    await page.getByTestId("settings-audio-stereo-wide").click();
    await page.getByTestId("settings-audio-reverb-room").click();
    await expect(page.getByTestId("settings-audio-stereo-wide")).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await audioFxCalls(page)).filter((c) => c.method === "setAudioProcessing").pop())
      .toEqual({
        method: "setAudioProcessing",
        params: { levelling: true, bassDb: 0, midDb: 0, trebleDb: 0, stereoWidth: 70, reverb: 25 },
      });

    const measured = await measureErgonomics(section);
    expect(measured.targetCount).toBeGreaterThanOrEqual(8);
    expect(measured.textOffenders, "Text below the size floor").toEqual([]);
    expect(measured.bodyOffenders, "Body text below the size floor").toEqual([]);
    expect(measured.targetOffenders, "Controls below the target size").toEqual([]);
    await noHorizontalOverflow(page);
    await keepShot(section, "audio-processing-compact");
  });

  test("the equalizer is reachable and adjustable with the focus ring alone @layout", async ({ page }) => {
    test.setTimeout(120_000);
    await installAudioFxMock(page);
    await enableKeypad(page);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await settle(page, "compact");
    if ((await page.getByTestId("settings-audio-processing").getAttribute("data-open")) !== "true")
      await page.getByTestId("settings-section-toggle-audio-processing").click();

    await page.keyboard.press("ArrowDown");
    const bass = page.getByTestId("settings-audio-eq-bass");
    expect(await ringFocus(page, page.getByTestId("settings-audio-levelling"), 120)).toBe(true);
    await expect(page.getByTestId("settings-audio-eq-bass-value")).toHaveText("0 dB");
    expect(await ringFocus(page, bass.locator('[role="slider"]'), 40)).toBe(true);
    const inView = await bass.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(inView, "The slider the ring selected is scrolled into view").toBe(true);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("settings-audio-eq-bass-value")).toHaveText("+3 dB");
    await expect
      .poll(async () => (await audioFxCalls(page)).filter((c) => c.method === "setAudioProcessing").pop())
      .toMatchObject({ params: { bassDb: 3 } });
    await page.getByTestId("settings-audio-eq-reset").scrollIntoViewIfNeeded();
    await page.getByTestId("settings-audio-eq-reset").click();
    await expect(page.getByTestId("settings-audio-eq-bass-value")).toHaveText("0 dB");
  });
});

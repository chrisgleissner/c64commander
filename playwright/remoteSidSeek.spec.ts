/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Fast forward, rewind and jumps for a SID the C64 plays itself, through the same Previous, Next
 * and progress bar the on-device engine uses. The mock server models the Ultimate's SID player
 * (tests/mocks/sidPlayerSimulation.ts), so each test checks what reached the "device": the held
 * left-arrow key, the CPU Speed writes, and that both are given back.
 */

import { test, expect } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";
import * as path from "node:path";
import { saveCoverageFromPage } from "./withCoverage";
import { createMockC64Server, type MockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { clickSourceSelectionButton } from "./sourceSelection";

const SEEKABLE_TUNE_FOLDER = path.resolve("playwright/fixtures/remote-seek");
const DEVICE_CPU_SPEEDS = [
  "1",
  "2",
  "3",
  "4",
  "6",
  "8",
  "10",
  "12",
  "14",
  "16",
  "20",
  "24",
  "32",
  "40",
  "48",
  "64",
].map((mhz) => mhz.padStart(2, " "));

/**
 * The shared fixture, with CPU Speed spelled as the firmware spells it (" 1" to " 8" are space-padded)
 * and the Audio Mixer's Vol Master, which a seek turns off while it fast forwards.
 */
const deviceConfigState = () => {
  const state = structuredClone(uiFixtures.configState);
  state["U64 Specific Settings"]["CPU Speed"] = { value: " 1", options: DEVICE_CPU_SPEEDS };
  state["Audio Mixer"]["Vol Master"] = { value: " 0 dB", options: ["OFF", "-42 dB", "-6 dB", " 0 dB", "+6 dB"] };
  return state;
};

const masterVolumeWrites = () =>
  server.requests
    .filter((request) => request.method === "PUT" && request.url.includes("/Vol%20Master?value="))
    .map((request) => decodeURIComponent(request.url.split("value=")[1]).trim());

let server: MockC64Server;

const cpuSpeedWrites = () =>
  server.requests
    .filter((request) => request.method === "PUT" && request.url.includes("/CPU%20Speed?value="))
    .map((request) => decodeURIComponent(request.url.split("value=")[1]).trim());

const keyEvents = (key: string) =>
  server.machineInputEvents.filter((event) => event.inputs.includes(key)).map((event) => event.transition);
/** Presses only: every restore also releases minus and plus, whether or not they were pressed. */
const keyPresses = (key: string) => keyEvents(key).filter((transition) => transition === "press").length;

const startSeekableTune = async (page: Page) => {
  await page.goto("/play");
  await page.getByRole("button", { name: /Add items|Add more items/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await clickSourceSelectionButton(page.getByRole("dialog"), "This device");
  await page
    .locator('[data-slot-active="true"] input[type="file"][webkitdirectory]')
    .setInputFiles([SEEKABLE_TUNE_FOLDER]);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByTestId("playlist-play").click();
  await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);
  // The hold is only offered once the app has found the SID player on the C64's screen.
  await expect(page.getByTestId("playlist-next")).toHaveAttribute("title", /hold to fast forward/, { timeout: 10000 });
};

const hold = async (page: Page, target: Locator, ms: number) => {
  const box = await target.boundingBox();
  if (!box) throw new Error("hold target has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
};

/** The tune's length as the progress bar shows it: elapsed plus remaining. */
const durationSeconds = async (page: Page) => {
  const seconds = (label: string) => {
    const [minutes, secs] = label
      .replace(/[^0-9:]/g, "")
      .split(":")
      .map(Number);
    return minutes * 60 + secs;
  };
  return (
    seconds(await page.getByTestId("playback-elapsed").innerText()) +
    seconds(await page.getByTestId("playback-remaining").innerText())
  );
};

const tapProgressAt = async (page: Page, fraction: number) => {
  const bar = page.getByTestId("playback-progress-seek");
  const box = await bar.boundingBox();
  if (!box) throw new Error("progress bar has no box");
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
};

const expectDeviceGivenBack = async () => {
  await expect.poll(() => server.sidPlayer?.heldKeys ?? ["no player"]).toEqual([]);
  await expect.poll(() => String(server.getState()["U64 Specific Settings"]?.["CPU Speed"]?.value)).toBe(" 1");
  await expect.poll(() => server.getState()["U64 Specific Settings"]?.["Turbo Control"]?.value).toBe("Off");
  await expect.poll(() => server.getState()["Audio Mixer"]?.["Vol Master"]?.value).toBe(" 0 dB");
};

/** A jump has landed once the timer shows a position again rather than the target it was heading for. */
const expectLanded = async (page: Page) => {
  await expect(page.getByTestId("playback-elapsed")).not.toContainText("⏵", { timeout: 20000 });
  await expectDeviceGivenBack();
};

test.describe("Remote SID seek", () => {
  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(deviceConfigState(), {}, { sidPlayer: true });
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test("holding Next fast forwards the C64's tune faster each second and gives CPU Speed back", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startSeekableTune(page);
    const startedAt = server.sidPlayer?.tunePositionSeconds ?? 0;
    await hold(page, page.getByTestId("playlist-next"), 2000);

    await expectDeviceGivenBack();
    expect(keyEvents("arrow_left")[0]).toBe("press");
    expect(keyEvents("arrow_left").at(-1)).toBe("release");
    // A second into the hold the CPU goes to 2 MHz; Turbo Control was Off, so it is switched to Manual
    // for that and back to Off afterwards (checked by expectDeviceGivenBack).
    expect(cpuSpeedWrites()[0]).toBe("2");
    const gained = (server.sidPlayer?.tunePositionSeconds ?? 0) - startedAt;
    expect(gained).toBeGreaterThan(10);
    const shown = await page.getByTestId("playback-elapsed").innerText();
    const [minutes, seconds] = shown
      .replace(/[^0-9:]/g, "")
      .split(":")
      .map(Number);
    expect(Math.abs(minutes * 60 + seconds - (server.sidPlayer?.tunePositionSeconds ?? 0))).toBeLessThan(3);
    // A hold that fast forwarded must not also skip to the next track.
    expect(server.sidplayRequests).toHaveLength(1);
    await attachStepScreenshot(page, testInfo, "after-fast-forward");
  });

  test("tapping the progress bar jumps the C64's tune there and back", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startSeekableTune(page);

    const duration = await durationSeconds(page);

    await tapProgressAt(page, 0.75);
    await expect
      .poll(() => server.sidPlayer?.tunePositionSeconds ?? 0, { timeout: 15000 })
      .toBeGreaterThan(duration * 0.75 - 0.5);
    await expectDeviceGivenBack();
    expect(server.sidPlayer?.restarts).toBe(1);

    await tapProgressAt(page, 0.25);
    await expect.poll(() => server.sidPlayer?.restarts, { timeout: 15000 }).toBe(3);
    await expectLanded(page);
    const landed = server.sidPlayer?.tunePositionSeconds ?? 0;
    expect(landed).toBeGreaterThan(duration * 0.25 - 0.5);
    expect(landed).toBeLessThan(duration * 0.25 + 4);
    // One backward jump, one restart.
    expect(keyPresses("minus")).toBe(1);
    await attachStepScreenshot(page, testInfo, "after-jumps");
  });

  test("holding Previous rewinds the C64's tune by restarting it and fast forwarding to the target", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startSeekableTune(page);
    const duration = await durationSeconds(page);
    // Far enough from the end that the tune does not finish while the test holds Previous.
    await tapProgressAt(page, 0.6);
    await expect
      .poll(() => server.sidPlayer?.tunePositionSeconds ?? 0, { timeout: 15000 })
      .toBeGreaterThan(duration * 0.6 - 0.5);
    await expectDeviceGivenBack();
    const before = server.sidPlayer?.tunePositionSeconds ?? 0;

    // Held for one step, which goes back 10 seconds.
    await hold(page, page.getByTestId("playlist-prev"), 1000);
    await expect.poll(() => keyPresses("plus"), { timeout: 15000 }).toBe(1);
    await expectLanded(page);
    // The rewind was not heard: Vol Master went off before the restart and came back once it landed.
    expect(masterVolumeWrites().slice(-2)).toEqual(["OFF", "0 dB"]);
    const landed = server.sidPlayer?.tunePositionSeconds ?? 0;
    expect(landed).toBeGreaterThan(before - 11);
    expect(landed).toBeLessThan(before);
    expect(server.sidplayRequests).toHaveLength(1);
    await attachStepScreenshot(page, testInfo, "after-rewind");
  });

  test("stopping during a held fast forward releases the key and CPU Speed before the C64 is reset", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startSeekableTune(page);
    const next = page.getByTestId("playlist-next");
    const box = await next.boundingBox();
    if (!box) throw new Error("Next has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => cpuSpeedWrites().length, { timeout: 5000 }).toBeGreaterThan(0);
    // Stop while the finger is still on Next.
    await page.getByTestId("playlist-play").dispatchEvent("click");
    await expect.poll(() => server.requests.some((request) => request.url.startsWith("/v1/machine:reset"))).toBe(true);
    await page.mouse.up();

    await expectDeviceGivenBack();
    const order = server.requests.map((request) => `${request.method} ${request.url}`);
    const reset = order.findIndex((entry) => entry.includes("/v1/machine:reset"));
    const speedRestored = order.findLastIndex((entry) => entry.includes("CPU%20Speed?value=%201"));
    expect(speedRestored).toBeGreaterThan(-1);
    expect(speedRestored).toBeLessThan(reset);
    await attachStepScreenshot(page, testInfo, "stopped-during-fast-forward");
  });
});

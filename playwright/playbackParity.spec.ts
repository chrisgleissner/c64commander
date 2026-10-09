/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Playback parity in CI: the scenarios of playwright/parity/playbackParityScenarios.ts, run on the
 * web build against the mock server, once with the tune on the phone and once on the C64. The same
 * scenarios run on the bench against a real phone and Ultimate (tools/hil/playback_parity_hil.ts).
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import * as path from "node:path";
import { saveCoverageFromPage } from "./withCoverage";
import { createMockC64Server, type MockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { clickSourceSelectionButton } from "./sourceSelection";
import {
  PARITY_SCENARIOS,
  type ClockTransition,
  type ParityDriver,
  type ParityRoute,
} from "./parity/playbackParityScenarios";

const SEEKABLE_TUNE_FOLDER = path.resolve("playwright/fixtures/remote-seek");
const DEVICE_CPU_SPEEDS = ["1", "2", "4", "8", "16", "32", "48", "64"].map((mhz) => mhz.padStart(2, " "));
const JOURNAL_KEY = "c64u_remote_seek_device_journal_v1";

/** The shared fixture with the firmware's padded CPU Speed options and the Audio Mixer's Vol Master. */
const deviceConfigState = () => {
  const state = structuredClone(uiFixtures.configState);
  state["U64 Specific Settings"]["CPU Speed"] = { value: " 1", options: DEVICE_CPU_SPEEDS };
  state["Audio Mixer"]["Vol Master"] = { value: " 0 dB", options: ["OFF", "-42 dB", "-6 dB", " 0 dB", "+6 dB"] };
  return state;
};

const parseClock = (text: string) => {
  const match = /(\d+):(\d\d)/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** The seconds the elapsed label turned to, leaving out the moments it showed a seek's target instead. */
const shownTransitions = (log: Array<{ atMs: number; text: string }>): ClockTransition[] => {
  const transitions: ClockTransition[] = [];
  for (const { atMs, text } of log) {
    const seconds = /[⏵⏸]/.test(text) ? null : parseClock(text);
    if (seconds !== null && transitions.at(-1)?.seconds !== seconds) transitions.push({ atMs, seconds });
  }
  return transitions;
};

const webDriver = (page: Page, server: MockC64Server): ParityDriver => {
  const center = async (testId: string) => {
    const box = await page.getByTestId(testId).boundingBox();
    if (!box) throw new Error(`${testId} has no box`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  };
  return {
    label: "web build against the mock server",
    async startTune(route: ParityRoute) {
      await page.addInitScript(
        (engine: string) => {
          localStorage.setItem("c64u_local_engine_enabled", "1");
          localStorage.setItem("c64u_playback_engine", engine);
        },
        route === "phone" ? "local" : "c64",
      );
      await page.goto("/play");
      await page.getByRole("button", { name: /Add items|Add more items/i }).click();
      await clickSourceSelectionButton(page.getByRole("dialog"), "This device");
      await page
        .locator('[data-slot-active="true"] input[type="file"][webkitdirectory]')
        .setInputFiles([SEEKABLE_TUNE_FOLDER]);
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.getByTestId("playlist-play").click();
      await expect(page.getByTestId("playlist-next")).toHaveAttribute("title", /hold to fast forward/, {
        timeout: 15000,
      });
    },
    tap: (testId) => page.getByTestId(testId).click(),
    async hold(testId, ms) {
      const { x, y } = await center(testId);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(ms);
      await page.mouse.up();
    },
    async tapBar(fraction) {
      const { box } = await center("playback-progress-seek");
      await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
    },
    async shownSeconds() {
      // A seek on the C64 shows its target with ⏵; one on the phone shows that it waits to continue.
      if (await page.locator('[aria-label^="Waiting to continue at"]').count()) return null;
      const text = await page.getByTestId("playback-elapsed").innerText();
      return text.includes("⏵") ? null : parseClock(text);
    },
    async durationSeconds() {
      const elapsed = parseClock(await page.getByTestId("playback-elapsed").innerText()) ?? 0;
      return elapsed + (parseClock(await page.getByTestId("playback-remaining").innerText()) ?? 0);
    },
    async transportState() {
      const play = await page.getByTestId("playlist-play").getAttribute("aria-label");
      const pause = await page.getByTestId("playlist-pause").getAttribute("aria-label");
      if (play !== "Stop") return "stopped";
      return pause === "Resume" ? "paused" : "playing";
    },
    truthSeconds: async (route) => (route === "c64" ? (server.sidPlayer?.tunePositionSeconds ?? null) : null),
    async machineLeftChanged(route) {
      const changed: string[] = [];
      const journal = await page.evaluate((key) => localStorage.getItem(key), JOURNAL_KEY);
      if (journal) changed.push(`journal left: ${journal}`);
      if (route === "phone") return changed;
      const state = server.getState();
      const cpu = String(state["U64 Specific Settings"]?.["CPU Speed"]?.value);
      const volume = String(state["Audio Mixer"]?.["Vol Master"]?.value);
      if (cpu !== " 1") changed.push(`CPU Speed ${JSON.stringify(cpu)}`);
      if (volume !== " 0 dB") changed.push(`Vol Master ${JSON.stringify(volume)}`);
      if (server.sidPlayer?.heldKeys.length) changed.push(`keys held: ${server.sidPlayer.heldKeys.join(",")}`);
      return changed;
    },
    async recordClocks(during) {
      await page.evaluate(() => {
        const log: Array<{ atMs: number; text: string }> = [];
        (window as unknown as { __clockLog: typeof log }).__clockLog = log;
        const elapsed = document.querySelector('[data-testid="playback-elapsed"]')!;
        new MutationObserver(() => log.push({ atMs: Date.now(), text: elapsed.textContent ?? "" })).observe(elapsed, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      const device: ClockTransition[] = [];
      const sample = setInterval(() => {
        const seconds = server.sidPlayer?.shownClockSeconds;
        if (seconds !== undefined && device.at(-1)?.seconds !== seconds) device.push({ atMs: Date.now(), seconds });
      }, 5);
      try {
        await during();
      } finally {
        clearInterval(sample);
      }
      const log = await page.evaluate(
        () => (window as unknown as { __clockLog: Array<{ atMs: number; text: string }> }).__clockLog,
      );
      return { page: shownTransitions(log), device };
    },
    wait: (ms) => page.waitForTimeout(ms),
  };
};

for (const route of ["phone", "c64"] as const) {
  test.describe(`Playback parity with the tune on the ${route === "phone" ? "phone" : "C64"}`, () => {
    let server: MockC64Server;

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

    for (const scenario of PARITY_SCENARIOS.filter((candidate) => !candidate.needsMicrophone)) {
      test(scenario.name, async ({ page }: { page: Page }) => {
        test.slow();
        const driver = webDriver(page, server);
        await driver.startTune(route);
        await scenario.run(driver, route);
      });
    }
  });
}

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Playback chaos in CI: playwright/parity/chaosScenario.ts against the mock server, switching between
 * the phone and the C64 route, with the page reloaded or hidden in the middle of holds and jumps. The
 * same run goes against a real phone and Ultimate with tools/hil/playback_parity_hil.ts --chaos.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import { createMockC64Server, type MockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { runChaos } from "./parity/chaosScenario";
import { deviceConfigState, webDriver } from "./parity/webParityDriver";

const MINUTES = Number(process.env.CHAOS_MINUTES ?? "3");

test.describe("Playback chaos", () => {
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

  for (const seed of [4561, 9087]) {
    test(`survives random overlapping gestures on both routes, seed ${seed}`, async ({ page }: { page: Page }) => {
      test.setTimeout((MINUTES + 4) * 60_000);
      const lines: string[] = [];
      const driver = { ...webDriver(page, server), report: (line: string) => lines.push(line) };
      const records = await runChaos(driver, { seed, minutes: MINUTES, routes: ["c64", "phone"] });
      console.log(lines.join("\n"));
      expect(records.length).toBeGreaterThan(5);
      expect(records.filter((record) => record.violations.length)).toEqual([]);
    });
  }
});

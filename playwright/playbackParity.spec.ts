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

import { test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import { createMockC64Server, type MockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { PARITY_SCENARIOS } from "./parity/playbackParityScenarios";
import { deviceConfigState, webDriver } from "./parity/webParityDriver";

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

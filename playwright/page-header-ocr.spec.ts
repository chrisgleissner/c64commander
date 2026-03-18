/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import {
  allowVisualOverflow,
  assertNoUiIssues,
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const HEADER_CASES = [
  { slug: "home", route: "/", expectedTitle: "Home" },
  { slug: "play", route: "/play", expectedTitle: "Play Files" },
  { slug: "disks", route: "/disks", expectedTitle: "Disks" },
  { slug: "config", route: "/config", expectedTitle: "Config" },
  { slug: "settings", route: "/settings", expectedTitle: "Settings" },
  { slug: "docs", route: "/docs", expectedTitle: "Docs" },
] as const;

const artifactRoot = path.resolve("artifacts/page-headers");

const normalizeOcr = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const readHeaderTextWithOcr = async (headerImagePath: string) => {
  const raw = execFileSync("tesseract", [headerImagePath, "stdout", "--psm", "6"], {
    encoding: "utf8",
  });
  return String(raw).trim();
};

const captureScreenArtifacts = async (page: Page, testInfo: TestInfo, slug: string, expectedTitle: string) => {
  const activeHeader = page.locator('[data-slot-active="true"] header');
  await expect(activeHeader).toBeVisible();
  await expect(activeHeader.getByRole("heading", { name: expectedTitle })).toBeVisible();

  const artifactDir = path.join(artifactRoot, slug);
  await fs.mkdir(artifactDir, { recursive: true });

  const screenPath = path.join(artifactDir, "screen.png");
  const headerPath = path.join(artifactDir, "header.png");
  const ocrPath = path.join(artifactDir, "ocr.txt");

  await page.screenshot({ path: screenPath });
  await activeHeader.screenshot({ path: headerPath });

  const ocrText = await readHeaderTextWithOcr(headerPath);
  await fs.writeFile(ocrPath, `${ocrText}\n`, "utf8");

  expect(normalizeOcr(ocrText)).toContain(normalizeOcr(expectedTitle));

  await attachStepScreenshot(page, testInfo, `${slug}-screen`);

  return { ocrText, screenPath, headerPath, ocrPath };
};

test.describe("Primary page header OCR", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowVisualOverflow(testInfo, "Swipe runway keeps adjacent pages mounted outside the active viewport.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test("all primary screens render a non-blank header with OCR-visible titles", async ({ page }, testInfo) => {
    const observedTitles: Record<string, string> = {};

    for (const screen of HEADER_CASES) {
      await page.goto(screen.route);
      const { ocrText } = await captureScreenArtifacts(page, testInfo, screen.slug, screen.expectedTitle);
      observedTitles[screen.slug] = ocrText;
    }

    expect(observedTitles).toMatchObject({
      home: expect.stringMatching(/home/i),
      play: expect.stringMatching(/play/i),
      disks: expect.stringMatching(/disks/i),
      config: expect.stringMatching(/config/i),
      settings: expect.stringMatching(/settings/i),
      docs: expect.stringMatching(/docs/i),
    });
  });
});

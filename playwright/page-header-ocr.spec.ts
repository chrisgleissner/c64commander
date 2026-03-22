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
import sharp from "sharp";

import { createMockC64Server } from "../tests/mocks/mockC64Server";
import {
  normalizeHeaderOcrText,
  ocrContainsExpectedTitle,
  ocrContainsHeaderHealthState,
  ocrContainsSystemLabel,
  pickBestHeaderOcrCandidate,
  type HeaderOcrCandidate,
} from "../src/lib/pageHeaderOcr";
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

const artifactRoot = path.resolve("doc/img/app/details/page-headers");

const waitForPageVisualReady = async (page: Page) => {
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => (document as any).fonts?.ready ?? true);
  await page.waitForFunction(() => {
    const animations = document.getAnimations({ subtree: true });
    return animations.every((animation) => {
      if (animation.playState !== "running") return true;
      const timing = animation.effect?.getComputedTiming();
      return timing?.iterations === Infinity;
    });
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

const readHeaderTextWithOcr = async (headerImagePath: string, pageSegmentationMode: "6" | "7") => {
  const raw = execFileSync("tesseract", [headerImagePath, "stdout", "--psm", pageSegmentationMode], {
    encoding: "utf8",
  });
  return String(raw).trim();
};

const buildPreparedHeaderImage = async (headerImagePath: string) => {
  const preparedImagePath = headerImagePath.replace(/\.png$/, ".ocr.png");
  const sourceImage = sharp(headerImagePath);
  const metadata = await sourceImage.metadata();
  const sourceWidth = metadata.width ?? 400;
  const targetWidth = Math.max(sourceWidth * 3, 1200);

  await sourceImage
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.4 })
    .resize({ width: targetWidth, withoutEnlargement: false })
    .threshold(176)
    .toFile(preparedImagePath);

  return preparedImagePath;
};

const collectHeaderOcrCandidates = async (headerImagePath: string, expectedTitle: string) => {
  const preparedImagePath = await buildPreparedHeaderImage(headerImagePath);
  const passes: Array<{ label: string; imagePath: string; pageSegmentationMode: "6" | "7" }> = [
    { label: "original-psm6", imagePath: headerImagePath, pageSegmentationMode: "6" },
    { label: "prepared-psm6", imagePath: preparedImagePath, pageSegmentationMode: "6" },
    { label: "prepared-psm7", imagePath: preparedImagePath, pageSegmentationMode: "7" },
  ];
  const candidates: HeaderOcrCandidate[] = [];
  const errors: string[] = [];

  for (const pass of passes) {
    try {
      const text = await readHeaderTextWithOcr(pass.imagePath, pass.pageSegmentationMode);
      candidates.push({ label: pass.label, text });
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      errors.push(`${pass.label}: ${detail}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error(`All OCR passes failed for ${expectedTitle} (${headerImagePath})\n${errors.join("\n\n")}`);
  }

  return { candidates, preparedImagePath, errors };
};

const captureScreenArtifacts = async (page: Page, testInfo: TestInfo, slug: string, expectedTitle: string) => {
  const activeHeader = page.locator('[data-slot-active="true"] header');
  await expect(activeHeader).toBeVisible();
  await expect(activeHeader.getByRole("heading", { name: expectedTitle })).toBeVisible();
  await waitForPageVisualReady(page);

  const artifactDir = path.join(artifactRoot, slug);
  await fs.mkdir(artifactDir, { recursive: true });

  const screenPath = path.join(artifactDir, "screen.png");
  const headerPath = path.join(artifactDir, "header.png");
  const preparedHeaderPath = path.join(artifactDir, "header.ocr.png");
  const ocrPath = path.join(artifactDir, "ocr.txt");

  await page.screenshot({ path: screenPath });
  await activeHeader.screenshot({ path: headerPath });

  const { candidates, preparedImagePath, errors } = await collectHeaderOcrCandidates(headerPath, expectedTitle);
  if (preparedImagePath !== preparedHeaderPath) {
    await fs.copyFile(preparedImagePath, preparedHeaderPath);
  }
  const bestCandidate = pickBestHeaderOcrCandidate(candidates, expectedTitle);
  const ocrText = bestCandidate.text;
  const diagnosticLines = [
    `best=${bestCandidate.label}`,
    ...candidates.map((candidate) => `[${candidate.label}] ${candidate.text}`),
  ];
  if (errors.length > 0) {
    diagnosticLines.push("", "errors:", ...errors);
  }
  await fs.writeFile(ocrPath, `${diagnosticLines.join("\n")}\n`, "utf8");

  expect(normalizeHeaderOcrText(ocrText).length).toBeGreaterThan(expectedTitle.length);
  expect(ocrContainsExpectedTitle(ocrText, expectedTitle)).toBe(true);
  expect(ocrContainsSystemLabel(ocrText) || ocrContainsHeaderHealthState(ocrText)).toBe(true);

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
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
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

  test(
    "all primary screens render a non-blank header with OCR-visible titles",
    { tag: "@screenshots" },
    async ({ page }, testInfo) => {
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
    },
  );
});

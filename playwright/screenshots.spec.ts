/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import { execFile as execFileCb } from "node:child_process";
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
// Load full YAML config for tests
import "../tests/mocks/setupMockConfigForTests";
import { seedUiMocks } from "./uiMocks";
import { seedFtpConfig, startFtpTestServers } from "./ftpTestUtils";
import {
  allowVisualOverflow,
  allowWarnings,
  assertNoUiIssues,
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { disableTraceAssertions } from "./traceUtils";
import {
  DISPLAY_PROFILE_VIEWPORT_SEQUENCE,
  DISPLAY_PROFILE_VIEWPORTS,
  type DisplayProfileViewportId,
} from "./displayProfileViewports";
import { registerScreenshotSections, sanitizeSegment } from "./screenshotCatalog";
import { planHomeScreenshotSlices } from "./homeScreenshotLayout";
import {
  installFixedClock,
  installListPreviewLimit,
  installStableStorage,
  seedDiagnosticsAnalytics,
  seedDiagnosticsLogs,
  seedDiagnosticsTracesForAction,
  seedDiagnosticsTraces,
} from "./visualSeeds";

const SCREENSHOT_ROOT = path.resolve("doc/img/app");
const execFile = promisify(execFileCb);

const screenshotPath = (relativePath: string) => path.resolve(SCREENSHOT_ROOT, relativePath);

const screenshotLabel = (relativePath: string) => relativePath.replace(/\.[^.]+$/, "").replace(/[\\/]/g, "-");
const screenshotRepoPath = (relativePath: string) => path.posix.join("doc/img/app", relativePath);
const profileScreenshotPath = (pageId: string, profileId: DisplayProfileViewportId, fileName: string) =>
  `${pageId}/profiles/${profileId}/${fileName}`;
const diagnosticsProfileScreenshotPath = (profileId: DisplayProfileViewportId, fileName: string) =>
  `profiles/${profileId}/${fileName}`;

const seedLiveDiagnosticsHealthProgress = async (page: Page) => {
  await page.waitForFunction(() => typeof window.__c64uDiagnosticsTestBridge?.seedOverlayState === "function");
  await page.evaluate(() => {
    window.__c64uDiagnosticsTestBridge?.seedOverlayState({
      healthCheckRunning: true,
      lastHealthCheckResult: null,
      liveHealthCheckProbes: {
        REST: {
          probe: "REST",
          outcome: "Success",
          durationMs: 54,
          reason: null,
          startMs: Date.now() - 420,
        },
        FTP: {
          probe: "FTP",
          outcome: "Success",
          durationMs: 128,
          reason: null,
          startMs: Date.now() - 280,
        },
      },
    });
  });
};

const clearLiveDiagnosticsHealthProgress = async (page: Page) => {
  await page.evaluate(() => {
    window.__c64uDiagnosticsTestBridge?.seedOverlayState({
      healthCheckRunning: false,
      liveHealthCheckProbes: null,
    });
  });
};

const ensureScreenshotDir = async (filePath: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const decodePngToRgba = async (source: string | Buffer) => {
  const { data, info } = await sharp(source, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
  };
};

// Fuzzy-comparison uses grayscale Mean Absolute Error (MAE).
// Converting to grayscale cancels subpixel RGB antialiasing noise.
// MAE weights by magnitude, so a few large-diff pixels (real change)
// are easily distinguished from many tiny-diff pixels (font-AA jitter).
//
// Threshold calibrated from visual inspection of 110 modified screenshots:
//   font-rendering noise peaks at MAE ≈ 4.78 (out of 255)
//   real content changes start at MAE ≈ 5.11
// Threshold set at 5.0 — sits cleanly in the gap with no overlap.
// When in doubt, err on caution: errors fall through to false (keep the file).
const GRAYSCALE_MAE_THRESHOLD = 5.0;

const isFuzzyIdenticalToHead = async (repoPath: string, screenshotBuffer: Buffer) => {
  try {
    const { stdout: headBlob } = await execFile("git", ["show", `HEAD:${repoPath}`], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    const toGrey = async (src: Buffer) => {
      const { data, info } = await sharp(src, { limitInputPixels: false })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data, total: info.width * info.height };
    };
    const [head, next] = await Promise.all([toGrey(headBlob), toGrey(screenshotBuffer)]);
    if (head.total !== next.total) return false;
    let sumDiff = 0;
    for (let i = 0; i < head.total; i++) sumDiff += Math.abs(head.data[i] - next.data[i]);
    return sumDiff / head.total < GRAYSCALE_MAE_THRESHOLD;
  } catch {
    return false; // err on caution
  }
};

const pngFingerprint = ({ data, width, height }: Awaited<ReturnType<typeof decodePngToRgba>>) =>
  `${width}x${height}:${createHash("sha256").update(data).digest("hex")}`;

interface HeadScreenshotCatalog {
  fingerprints: Map<string, string[]>;
  pathFingerprints: Map<string, string>;
  trackedPaths: Set<string>;
}

let headScreenshotCatalogPromise: Promise<HeadScreenshotCatalog> | null = null;

const loadHeadScreenshotCatalog = async (): Promise<HeadScreenshotCatalog> => {
  if (!headScreenshotCatalogPromise) {
    headScreenshotCatalogPromise = (async () => {
      try {
        const { stdout } = await execFile("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "doc/img/app"], {
          maxBuffer: 8 * 1024 * 1024,
        });
        const trackedPaths = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.endsWith(".png"));
        const fingerprints = new Map<string, string[]>();
        const pathFingerprints = new Map<string, string>();
        const decodedEntries = await Promise.all(
          trackedPaths.map(async (trackedPath) => {
            try {
              const { stdout: headBlob } = await execFile("git", ["show", `HEAD:${trackedPath}`], {
                encoding: "buffer",
                maxBuffer: 64 * 1024 * 1024,
              });
              const decoded = await decodePngToRgba(headBlob);
              return {
                trackedPath,
                fingerprint: pngFingerprint(decoded),
              };
            } catch (error) {
              console.warn(`Failed to load tracked screenshot ${trackedPath} from HEAD.`, error);
              return null;
            }
          }),
        );

        decodedEntries.forEach((entry) => {
          if (!entry) return;
          const matches = fingerprints.get(entry.fingerprint) ?? [];
          matches.push(entry.trackedPath);
          fingerprints.set(entry.fingerprint, matches);
          pathFingerprints.set(entry.trackedPath, entry.fingerprint);
        });

        return {
          fingerprints,
          pathFingerprints,
          trackedPaths: new Set(trackedPaths),
        };
      } catch (error) {
        console.warn("Failed to build tracked screenshot catalog from HEAD.", error);
        return {
          fingerprints: new Map<string, string[]>(),
          pathFingerprints: new Map<string, string>(),
          trackedPaths: new Set<string>(),
        };
      }
    })();
  }

  return headScreenshotCatalogPromise;
};

const hasPixelDiffAgainstExisting = async (filePath: string, screenshotBuffer: Buffer) => {
  try {
    await fs.access(filePath);
  } catch {
    return true;
  }

  try {
    const [existing, next] = await Promise.all([decodePngToRgba(filePath), decodePngToRgba(screenshotBuffer)]);
    if (existing.width !== next.width || existing.height !== next.height) {
      return true;
    }
    return !existing.data.equals(next.data);
  } catch (error) {
    console.warn(`Failed to compare screenshot pixels for ${filePath}.`, error);
    return true;
  }
};

const matchesTrackedScreenshotAtAnotherPath = async (relativePath: string, screenshotBuffer: Buffer) => {
  const catalog = await loadHeadScreenshotCatalog();
  const targetRepoPath = screenshotRepoPath(relativePath);
  if (catalog.trackedPaths.has(targetRepoPath)) {
    return false;
  }

  try {
    const fingerprint = pngFingerprint(await decodePngToRgba(screenshotBuffer));
    const matches = catalog.fingerprints.get(fingerprint) ?? [];
    return matches.some((trackedPath) => trackedPath !== targetRepoPath);
  } catch (error) {
    console.warn(`Failed to compare ${relativePath} against tracked screenshot fingerprints.`, error);
    return false;
  }
};

const waitForStableRender = async (page: Page) => {
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => (document as any).fonts?.ready ?? true);
  await page.waitForFunction(() => {
    const animations = document.getAnimations();
    return animations.every((animation) => {
      if (animation.playState !== "running") return true;
      const timing = animation.effect?.getComputedTiming();
      return timing?.iterations === Infinity;
    });
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

const applyDisplayProfileViewport = async (page: Page, profileId: DisplayProfileViewportId) => {
  const profile = DISPLAY_PROFILE_VIEWPORTS[profileId];
  await page.setViewportSize(profile.viewport);
  const applyOverride = async () => {
    await page.evaluate((override) => {
      localStorage.setItem("c64u_display_profile_override", override);
      window.dispatchEvent(
        new CustomEvent("c64u-ui-preferences-changed", {
          detail: { displayProfileOverride: override },
        }),
      );
    }, profile.override);
  };

  await applyOverride();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.displayProfile), { timeout: 3000 })
    .toBe(profile.expectedProfile)
    .catch(async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await applyOverride();
    });
  await waitForStableRender(page);
};

const openViewAllIfPresent = async (page: Page) => {
  const viewAllButton = getActiveMain(page).getByRole("button", { name: /View all|Show all|See all/i });
  if ((await viewAllButton.count()) === 0) {
    return null;
  }
  const firstButton = viewAllButton.first();
  if (!(await firstButton.isVisible().catch(() => false))) {
    return null;
  }
  await firstButton.click();
  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible().catch(() => false))) {
    return null;
  }
  return dialog;
};

const openImportDialog = async (page: Page) => {
  await getActiveMain(page)
    .getByRole("button", { name: /Add items|Add more items/i })
    .click();
  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible().catch(() => false))) {
    return null;
  }
  return dialog;
};

const waitForImportInterstitial = async (dialog: ReturnType<Page["getByRole"]>) => {
  const interstitial = dialog.getByTestId("import-selection-interstitial");
  if (await interstitial.isVisible().catch(() => false)) {
    return interstitial;
  }
  return null;
};

const waitForOverlaysToClear = async (page: Page) => {
  const notificationRegion = page.locator('[aria-label="Notifications (F8)"]');
  const openToasts = notificationRegion.locator('[data-state="open"], [role="status"]');
  await expect(openToasts).toHaveCount(0, { timeout: 10000 });
};

const seedLightingStudioState = async (page: Page, state: unknown) => {
  await page.addInitScript((payload) => {
    localStorage.setItem("c64u_lighting_studio_state:v1", JSON.stringify(payload));
  }, state);
};

const captureScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  relativePath: string,
  options?: {
    fullPage?: boolean;
    locator?: Locator;
    borderPx?: number;
    borderColor?: { r: number; g: number; b: number; alpha?: number };
    writeWhenTrackedDuplicate?: boolean;
  },
) => {
  const filePath = screenshotPath(relativePath);
  await ensureScreenshotDir(filePath);
  await waitForStableRender(page);
  await waitForOverlaysToClear(page);
  let screenshotBuffer = options?.locator
    ? await options.locator.screenshot({ animations: "disabled", caret: "hide" })
    : await page.screenshot({
        animations: "disabled",
        caret: "hide",
        fullPage: options?.fullPage ?? false,
      });
  if ((options?.borderPx ?? 0) > 0) {
    const borderPx = options?.borderPx ?? 0;
    const color = options?.borderColor ?? { r: 255, g: 255, b: 255, alpha: 1 };
    screenshotBuffer = await sharp(screenshotBuffer)
      .extend({
        top: borderPx,
        bottom: borderPx,
        left: borderPx,
        right: borderPx,
        background: color,
      })
      .png()
      .toBuffer();
  }

  const repoPath = screenshotRepoPath(relativePath);
  const catalog = await loadHeadScreenshotCatalog();
  const headFingerprint = catalog.pathFingerprints.get(repoPath);

  if (headFingerprint !== undefined) {
    // File exists in HEAD: compare new screenshot against HEAD pixels.
    const newFingerprint = pngFingerprint(await decodePngToRgba(screenshotBuffer));
    if (newFingerprint === headFingerprint) {
      // Pixels unchanged from HEAD - restore HEAD version to eliminate any binary-only git diff.
      await execFile("git", ["restore", "--source=HEAD", "--worktree", "--", repoPath]).catch((err) =>
        console.warn(`[screenshots] Failed to restore HEAD version of ${relativePath}.`, err),
      );
    } else if (await isFuzzyIdenticalToHead(repoPath, screenshotBuffer)) {
      // Only trivial rendering noise (e.g. subpixel / font-AA jitter) - restore HEAD.
      await execFile("git", ["restore", "--source=HEAD", "--worktree", "--", repoPath]).catch((err) =>
        console.warn(`[screenshots] Failed to restore HEAD version of ${relativePath}.`, err),
      );
    } else {
      // Genuinely changed pixels - write new screenshot.
      await fs.writeFile(filePath, screenshotBuffer);
    }
  } else {
    // New file (not yet in HEAD): compare against disk to avoid redundant writes.
    if (await hasPixelDiffAgainstExisting(filePath, screenshotBuffer)) {
      if (await matchesTrackedScreenshotAtAnotherPath(relativePath, screenshotBuffer)) {
        if (options?.writeWhenTrackedDuplicate) {
          await fs.writeFile(filePath, screenshotBuffer);
        } else {
          console.info(`[screenshots] Skipped ${relativePath}; pixels match an existing tracked screenshot.`);
        }
      } else {
        await fs.writeFile(filePath, screenshotBuffer);
      }
    }
  }

  await attachStepScreenshot(page, testInfo, screenshotLabel(relativePath));
};

const captureDiagnosticsScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  relativePath: string,
  options?: {
    fullPage?: boolean;
    writeWhenTrackedDuplicate?: boolean;
  },
) => captureScreenshot(page, testInfo, `diagnostics/${relativePath}`, options);

const scrollAndCapture = async (
  page: Page,
  testInfo: TestInfo,
  locator: ReturnType<Page["locator"]>,
  relativePath: string,
) => {
  await locator.scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, relativePath);
};

const getAppBarOffset = async (page: Page) =>
  page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--app-bar-height");
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  });

const scrollHeadingIntoView = async (page: Page, locator: ReturnType<Page["locator"]>, extraOffset = 12) => {
  await locator.scrollIntoViewIfNeeded();
  const offset = await getAppBarOffset(page);
  const targetY = await locator.evaluate(
    (node, payload) => {
      const rect = node.getBoundingClientRect();
      const desired = rect.top + window.scrollY - payload.offset - payload.extraOffset;
      return desired < 0 ? 0 : desired;
    },
    { offset, extraOffset },
  );
  await page.evaluate((value) => window.scrollTo(0, value), targetY);
};

const capturePageSections = async (page: Page, testInfo: TestInfo, pageId: string) => {
  const headings = getActiveMain(page).locator("h2, h3, h4");
  const count = await headings.count();
  if (count === 0) return;

  const headingData: Array<{
    text: string;
    locator: ReturnType<Page["locator"]>;
  }> = [];
  for (let index = 0; index < count; index += 1) {
    const locator = headings.nth(index);
    const text = (await locator.innerText()).trim();
    if (!text) continue;
    headingData.push({ text, locator });
  }

  const slugs = headingData.map((entry) => sanitizeSegment(entry.text));
  const orderMap = await registerScreenshotSections(pageId, slugs);

  for (let index = 0; index < headingData.length; index += 1) {
    const entry = headingData[index];
    const slug = sanitizeSegment(entry.text);
    const order = orderMap.get(slug) ?? index + 1;
    await scrollHeadingIntoView(page, entry.locator);
    await captureScreenshot(page, testInfo, `${pageId}/sections/${String(order).padStart(2, "0")}-${slug}.png`);
  }
};

const captureDocsSections = async (page: Page, testInfo: TestInfo) => {
  const sections = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-controls^="docs-section-"]'))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((button) => ({
        controlId: button.getAttribute("aria-controls") ?? "",
        label: button.innerText.split("\n")[0]?.trim() ?? "",
      }))
      .filter((section) => section.controlId.length > 0 && section.label.length > 0),
  );
  if (sections.length === 0) return;
  const slugs = sections.map((section) => sanitizeSegment(section.label));
  const orderMap = await registerScreenshotSections("docs", slugs);
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const button = getActiveSlot(page).locator(`button[aria-controls="${section.controlId}"]`).first();
    const sectionId = section.controlId.replace(/^docs-section-/, "");
    const card = getActiveSlot(page).getByTestId(`docs-card-${sectionId}`).first();
    const getVisibleButtonExpandedState = () =>
      page.evaluate((visibleControlId) => {
        const visibleButton = Array.from(
          document.querySelectorAll<HTMLButtonElement>(`button[aria-controls="${visibleControlId}"]`),
        ).find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          const style = getComputedStyle(candidate);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        });
        return visibleButton?.getAttribute("aria-expanded") ?? null;
      }, section.controlId);
    const slug = sanitizeSegment(section.label);
    const order = orderMap.get(slug) ?? index + 1;
    await scrollHeadingIntoView(page, button);
    await page.evaluate((controlId) => {
      const visibleButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`button[aria-controls="${controlId}"]`),
      ).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      visibleButton?.click();
    }, section.controlId);
    await expect.poll(getVisibleButtonExpandedState).toBe("true");
    await waitForStableRender(page);
    await scrollHeadingIntoView(page, button);
    await captureScreenshot(page, testInfo, `docs/sections/${String(order).padStart(2, "0")}-${slug}.png`, {
      locator: card,
    });
    await page.evaluate((controlId) => {
      const visibleButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`button[aria-controls="${controlId}"]`),
      ).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      visibleButton?.click();
    }, section.controlId);
    await expect.poll(getVisibleButtonExpandedState).toBe("false");
    await waitForStableRender(page);
  }
};

const captureConfigSections = async (page: Page, testInfo: TestInfo) => {
  const toggles = getActiveMain(page).locator('[data-testid^="config-category-"]');
  const count = await toggles.count();
  if (count === 0) return;
  const labels: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = (await toggles.nth(index).innerText()).split("\n")[0]?.trim() ?? "";
    if (label) labels.push(sanitizeSegment(label));
  }
  const orderMap = await registerScreenshotSections("config", labels);
  for (let index = 0; index < count; index += 1) {
    const toggle = toggles.nth(index);
    const label = (await toggle.innerText()).split("\n")[0]?.trim() ?? "";
    if (!label) continue;
    const slug = sanitizeSegment(label);
    const order = orderMap.get(slug) ?? index + 1;
    await scrollHeadingIntoView(page, toggle);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitForStableRender(page);
    await scrollHeadingIntoView(page, toggle);
    await captureScreenshot(page, testInfo, `config/sections/${String(order).padStart(2, "0")}-${slug}.png`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitForStableRender(page);
  }
};

const captureLabeledSections = async (page: Page, testInfo: TestInfo, pageId: string) => {
  const sections = getActiveMain(page).locator("[data-section-label]");
  const count = await sections.count();
  if (count === 0) return;
  const labels: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = (await sections.nth(index).getAttribute("data-section-label"))?.trim() ?? "";
    if (label) labels.push(sanitizeSegment(label));
  }
  const orderMap = await registerScreenshotSections(pageId, labels);
  for (let index = 0; index < count; index += 1) {
    const section = sections.nth(index);
    const label = (await section.getAttribute("data-section-label"))?.trim() ?? "";
    if (!label) continue;
    const slug = sanitizeSegment(label);
    const order = orderMap.get(slug) ?? index + 1;
    await scrollHeadingIntoView(page, section);
    await captureScreenshot(page, testInfo, `${pageId}/sections/${String(order).padStart(2, "0")}-${slug}.png`);
  }
};

const captureHomeSections = async (page: Page, testInfo: TestInfo) => {
  const layout = await page.evaluate(() => {
    const activeMain = document.querySelector('[data-slot-active="true"] main');
    const sections = Array.from(activeMain?.querySelectorAll("[data-section-label]") ?? [])
      .map((node) => {
        const label = node.getAttribute("data-section-label")?.trim() ?? "";
        const rect = node.getBoundingClientRect();
        return {
          label,
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
        };
      })
      .filter((section) => section.label.length > 0 && section.bottom > section.top);

    const rootStyle = getComputedStyle(document.documentElement);
    const main = activeMain;
    const mainStyle = main ? getComputedStyle(main) : null;
    const appBarHeight = Number.parseFloat(rootStyle.getPropertyValue("--app-bar-height")) || 0;
    const bottomInset = Number.parseFloat(mainStyle?.paddingBottom ?? "0") || 0;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    return {
      sections,
      viewportHeight: window.innerHeight,
      topInset: appBarHeight,
      bottomInset,
      maxScroll,
    };
  });

  const slices = planHomeScreenshotSlices({
    sections: layout.sections.map((section) => ({
      slug: sanitizeSegment(section.label),
      top: section.top,
      bottom: section.bottom,
    })),
    viewportHeight: layout.viewportHeight,
    topInset: layout.topInset,
    bottomInset: layout.bottomInset,
    maxScroll: layout.maxScroll,
  });

  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    await page.evaluate((value) => window.scrollTo(0, value), slice.scrollTop);
    await captureScreenshot(page, testInfo, `home/sections/${String(index + 1).padStart(2, "0")}-${slice.slug}.png`);
  }
};

const waitForConnected = async (page: Page) => {
  await expect(page.locator('[data-slot-active="true"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connectivity-state",
    "Online",
    {
      timeout: 10000,
    },
  );
};

const getActiveHealthBadge = (page: Page) =>
  page.locator('[data-slot-active="true"]').getByTestId("unified-health-badge");

const waitForDemoBadge = async (page: Page) => {
  await expect(getActiveHealthBadge(page)).toHaveAttribute("data-connectivity-state", "Demo", { timeout: 10000 });
};

const getActiveSlot = (page: Page) => page.locator('[data-slot-active="true"]');

const getActiveMain = (page: Page) => getActiveSlot(page).locator("main");

test.describe("App screenshots", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

  test.use({ locale: "en-US", timezoneId: "UTC" });

  test.beforeAll(async () => {
    // Use default YAML config (no initial state) to show all categories
    ftpServers = await startFtpTestServers();
    server = await createMockC64Server();
  });

  test.afterAll(async () => {
    await ftpServers.close();
    await server.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    disableTraceAssertions(testInfo, "Visual-only screenshots; trace assertions disabled.");
    await startStrictUiMonitoring(page, testInfo);
    allowVisualOverflow(testInfo, "Swipe runway keeps adjacent pages mounted outside the active viewport.");
    await installFixedClock(page);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: "",
    });
    await seedUiMocks(page, server.baseUrl);
    await installStableStorage(page);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.medium.viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
    }
  });

  test("capture home screenshots", { tag: "@screenshots" }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/");
    await waitForConnected(page);
    await expect(page.getByRole("button", { name: "Disks", exact: true })).toBeVisible();
    await page.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await waitForStableRender(page);
    await captureScreenshot(page, testInfo, "home/01-overview-dark.png");
    await page.emulateMedia({
      colorScheme: "light",
      reducedMotion: "reduce",
    });
  });

  test(
    "capture home profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await page.goto("/");
        await waitForConnected(page);
        await applyDisplayProfileViewport(page, profileId);
        await page.evaluate(() => window.scrollTo(0, 0));
        await captureScreenshot(page, testInfo, profileScreenshotPath("home", profileId, "01-overview.png"), {
          fullPage: true,
        });
      }
    },
  );

  test(
    "capture home interaction screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      const activeMain = getActiveMain(page);
      await page.request.post(`${server.baseUrl}/v1/configs`, {
        data: {
          "SID Addressing": {
            "SID Socket 1 Address": "$D400",
            "SID Socket 2 Address": "Unmapped",
            "UltiSID 1 Address": "$D420",
            "UltiSID 2 Address": "Unmapped",
          },
        },
      });
      await page.goto("/");
      await waitForConnected(page);
      await expect(activeMain.getByTestId("home-stream-endpoint-display-audio")).toHaveText(/\d+\.\d+\.\d+\.\d+:\d+/);

      await activeMain.getByTestId("home-stream-start-audio").click();
      await scrollAndCapture(
        page,
        testInfo,
        activeMain.getByTestId("home-stream-status"),
        "home/interactions/01-toggle.png",
      );

      await activeMain.getByTestId("home-drive-type-a").click();
      await captureScreenshot(page, testInfo, "home/interactions/02-dropdown.png");
      await page.keyboard.press("Escape");

      await activeMain.getByTestId("home-stream-edit-toggle-vic").click();
      const streamInput = activeMain.getByTestId("home-stream-endpoint-vic");
      if (await streamInput.isVisible().catch(() => false)) {
        await streamInput.click();
        await streamInput.fill("239.0.1.90:11000");
        await scrollAndCapture(
          page,
          testInfo,
          activeMain.getByTestId("home-stream-status"),
          "home/interactions/03-input.png",
        );
        await activeMain.getByTestId("home-stream-confirm-vic").click();
      }

      await expect(activeMain.getByTestId("home-sid-address-socket1")).toHaveText(/\$[0-9A-F]{4}|\$----/);
      await activeMain.getByTestId("home-sid-status").getByRole("button", { name: "Reset" }).click();
      await page.waitForTimeout(250);
      await scrollAndCapture(
        page,
        testInfo,
        activeMain.getByTestId("home-sid-status"),
        "home/sid/01-reset-post-silence.png",
      );
    },
  );

  test(
    "capture home RAM snapshot dialog screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      const seedHomeDialogSnapshots = async (variant: "default" | "snapshot-manager") => {
        await page.evaluate((mode) => {
          const HEADER_SIZE = 28;
          const buildSnap = (typeCode: number, ts: number): string => {
            const displayRanges =
              typeCode === 0
                ? ["$0000\u2013$00FF", "$0200\u2013$FFFF"]
                : typeCode === 1
                  ? ["$002B\u2013$0038", "$0801\u2013STREND"]
                  : typeCode === 2
                    ? ["VICBANK", "$D000\u2013$D02E", "$D800\u2013$DBFF", "$DD00\u2013$DD0F"]
                    : ["$0400\u2013$07E7", "$2000\u2013$20FF"];
            const snapType =
              typeCode === 0 ? "program" : typeCode === 1 ? "basic" : typeCode === 2 ? "screen" : "custom";
            const meta = JSON.stringify({
              snapshot_type: snapType,
              display_ranges: displayRanges,
              created_at: "2026-01-10 09:00:00",
            });
            const metaBytes = new TextEncoder().encode(meta);
            const total = HEADER_SIZE + metaBytes.length;
            const buf = new Uint8Array(total);
            const view = new DataView(buf.buffer);
            new TextEncoder().encode("C64SNAP\0").forEach((b: number, i: number) => {
              buf[i] = b;
            });
            view.setUint16(8, 1, true);
            view.setUint16(10, typeCode, true);
            view.setUint32(12, ts, true);
            view.setUint16(16, 0, true);
            view.setUint16(18, 0, true);
            view.setUint32(20, HEADER_SIZE, true);
            view.setUint32(24, metaBytes.length, true);
            buf.set(metaBytes, HEADER_SIZE);
            let binary = "";
            for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
            return btoa(binary);
          };
          const snapshots =
            mode === "snapshot-manager"
              ? [
                  {
                    id: "snap-1",
                    filename: "c64-program-20260110-090000.c64snap",
                    bytesBase64: buildSnap(0, 1736499600),
                    createdAt: "2026-01-10T09:00:00.000Z",
                    snapshotType: "program",
                    metadata: {
                      snapshot_type: "program",
                      display_ranges: ["$0000\u2013$00FF", "$0200\u2013$FFFF"],
                      created_at: "2026-01-10 09:00:00",
                      label: "JupiterLander.crt",
                    },
                  },
                  {
                    id: "snap-2",
                    filename: "c64-basic-20260110-080000.c64snap",
                    bytesBase64: buildSnap(1, 1736496000),
                    createdAt: "2026-01-10T08:00:00.000Z",
                    snapshotType: "basic",
                    metadata: {
                      snapshot_type: "basic",
                      display_ranges: ["$002B\u2013$0038", "$0801\u2013STREND"],
                      created_at: "2026-01-10 08:00:00",
                    },
                  },
                  {
                    id: "snap-3",
                    filename: "c64-screen-20260110-070000.c64snap",
                    bytesBase64: buildSnap(2, 1736492400),
                    createdAt: "2026-01-10T07:00:00.000Z",
                    snapshotType: "screen",
                    metadata: {
                      snapshot_type: "screen",
                      display_ranges: ["VICBANK", "$D000\u2013$D02E", "$D800\u2013$DBFF", "$DD00\u2013$DD0F"],
                      created_at: "2026-01-10 07:00:00",
                    },
                  },
                  {
                    id: "snap-4",
                    filename: "c64-custom-20260110-060000.c64snap",
                    bytesBase64: buildSnap(3, 1736488800),
                    createdAt: "2026-01-10T06:00:00.000Z",
                    snapshotType: "custom",
                    metadata: {
                      snapshot_type: "custom",
                      display_ranges: ["$0400\u2013$07E7", "$2000\u2013$20FF"],
                      created_at: "2026-01-10 06:00:00",
                    },
                  },
                ]
              : [
                  {
                    id: "snap-1",
                    filename: "c64-program-20260110-090000.c64snap",
                    bytesBase64: buildSnap(0, 1736499600),
                    createdAt: "2026-01-10T09:00:00.000Z",
                    snapshotType: "program",
                    metadata: {
                      snapshot_type: "program",
                      display_ranges: ["$0000\u2013$00FF", "$0200\u2013$FFFF"],
                      created_at: "2026-01-10 09:00:00",
                      label: "JupiterLander.crt",
                    },
                  },
                  {
                    id: "snap-2",
                    filename: "c64-basic-20260110-080000.c64snap",
                    bytesBase64: buildSnap(1, 1736496000),
                    createdAt: "2026-01-10T08:00:00.000Z",
                    snapshotType: "basic",
                    metadata: {
                      snapshot_type: "basic",
                      display_ranges: ["$002B\u2013$0038", "$0801\u2013STREND"],
                      created_at: "2026-01-10 08:00:00",
                    },
                  },
                  {
                    id: "snap-3",
                    filename: "c64-screen-20260110-070000.c64snap",
                    bytesBase64: buildSnap(2, 1736492400),
                    createdAt: "2026-01-10T07:00:00.000Z",
                    snapshotType: "screen",
                    metadata: {
                      snapshot_type: "screen",
                      display_ranges: ["VICBANK", "$D000\u2013$D02E", "$D800\u2013$DBFF", "$DD00\u2013$DD0F"],
                      created_at: "2026-01-10 07:00:00",
                    },
                  },
                ];

          localStorage.setItem(
            "c64u_snapshots:v1",
            JSON.stringify({
              version: 1,
              snapshots,
            }),
          );
          window.dispatchEvent(new CustomEvent("c64u-snapshots-updated", { detail: snapshots }));
        }, variant);
      };

      const activeMain = getActiveMain(page);
      await page.goto("/");
      await waitForConnected(page);
      await seedHomeDialogSnapshots("default");

      // Save RAM dialog
      await activeMain.getByTestId("home-save-ram").click();
      if (
        await page
          .getByTestId("save-ram-dialog")
          .isVisible()
          .catch(() => false)
      ) {
        await captureScreenshot(page, testInfo, "home/dialogs/01-save-ram-dialog.png");
        await page.getByTestId("save-ram-type-custom").click();
        await expect(page.getByTestId("save-ram-custom-form")).toBeVisible();
        await page.getByTestId("save-ram-custom-start").fill("0400");
        await page.getByTestId("save-ram-custom-end").fill("07E7");
        await page.getByTestId("save-ram-custom-add-range").click();
        await page.getByTestId("save-ram-custom-start-1").fill("2000");
        await page.getByTestId("save-ram-custom-end-1").fill("20FF");
        await captureScreenshot(page, testInfo, "home/dialogs/02-save-ram-custom-range.png");
        await page.keyboard.press("Escape");
      }

      // Snapshot Manager dialog
      await seedHomeDialogSnapshots("snapshot-manager");
      await activeMain.getByTestId("home-load-ram").click();
      if (
        await page
          .getByTestId("snapshot-manager-dialog")
          .isVisible()
          .catch(() => false)
      ) {
        await expect(page.getByTestId("snapshot-row")).toHaveCount(4);
        await captureScreenshot(page, testInfo, "home/dialogs/03-snapshot-manager.png");
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("snapshot-manager-dialog")).not.toBeVisible();
      }

      // Restore confirmation dialog
      await seedHomeDialogSnapshots("default");
      await page.reload();
      await waitForConnected(page);
      await getActiveMain(page).getByTestId("home-load-ram").click();
      if (
        await page
          .getByTestId("snapshot-manager-dialog")
          .isVisible()
          .catch(() => false)
      ) {
        await page.getByTestId("snapshot-row").first().click();
        if (
          await page
            .getByTestId("restore-snapshot-dialog")
            .isVisible()
            .catch(() => false)
        ) {
          await captureScreenshot(page, testInfo, "home/dialogs/04-restore-confirmation.png");
          await page.keyboard.press("Escape");
        }
      }
    },
  );

  test(
    "capture lighting studio screenshot",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await seedLightingStudioState(page, {
        activeProfileId: "bundled-connected",
        profiles: [
          {
            id: "studio-neon",
            name: "Neon Orbit",
            savedAt: "2026-01-10T08:30:00.000Z",
            pinned: true,
            surfaces: {
              case: {
                mode: "Fixed Color",
                pattern: "SingleColor",
                color: { kind: "named", value: "Blue" },
                intensity: 22,
                tint: "Pure",
              },
              keyboard: {
                mode: "Fixed Color",
                pattern: "SingleColor",
                color: { kind: "named", value: "Green" },
                intensity: 18,
                tint: "Warm",
              },
            },
          },
        ],
        automation: {
          connectionSentinel: {
            enabled: true,
            mappings: {
              connected: "bundled-connected",
            },
          },
          sourceIdentityMap: {
            enabled: true,
            mappings: {
              disks: "bundled-source-disks",
            },
          },
          circadian: {
            enabled: true,
            locationPreference: {
              useDeviceLocation: false,
              manualCoordinates: null,
              city: "Tokyo",
            },
          },
        },
      });

      await page.goto("/");
      await waitForConnected(page);

      await applyDisplayProfileViewport(page, "medium");
      await getActiveMain(page).getByTestId("home-lighting-studio").click();
      const dialogMedium = page.getByRole("dialog", { name: "Lighting Studio" });
      await expect(dialogMedium).toBeVisible();

      await captureScreenshot(page, testInfo, "home/dialogs/05-lighting-studio-medium.png", {
        borderPx: 6,
        borderColor: { r: 255, g: 255, b: 255, alpha: 1 },
      });

      await page.getByTestId("lighting-profile-studio-neon").click();
      await page.getByTestId("lighting-select-surface-keyboard").click();
      await page.getByTestId("lighting-compose-section").scrollIntoViewIfNeeded();
      await captureScreenshot(page, testInfo, "home/dialogs/06-lighting-studio-compose-medium.png");

      await page.getByTestId("lighting-automation-section").scrollIntoViewIfNeeded();
      await captureScreenshot(page, testInfo, "home/dialogs/07-lighting-studio-automation-medium.png");

      await page.getByTestId("lighting-open-context-lens").click();
      await expect(page.getByRole("dialog", { name: "Context Lens" })).toBeVisible();
      await captureScreenshot(page, testInfo, "home/dialogs/08-lighting-context-lens-medium.png");
    },
  );

  test("capture disks screenshots", { tag: "@screenshots" }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installListPreviewLimit(page, 3);
    await page.goto("/disks");
    await expect(page.getByRole("heading", { name: "Disks", level: 1 })).toBeVisible();
    await expect(getActiveMain(page).getByTestId("disk-list")).toContainText("Disk 1.d64");

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, "disks/01-overview.png");
    await capturePageSections(page, testInfo, "disks");

    const viewAllDialog = await openViewAllIfPresent(page);
    if (viewAllDialog) {
      await captureScreenshot(page, testInfo, "disks/collection/01-view-all.png");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test(
    "capture disks profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installListPreviewLimit(page, 3);
      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await page.goto("/disks");
        await applyDisplayProfileViewport(page, profileId);
        await page.goto("/disks");
        await expect(page.getByRole("heading", { name: "Disks", level: 1 })).toBeVisible();
        await captureScreenshot(page, testInfo, profileScreenshotPath("disks", profileId, "01-overview.png"));

        const viewAllDialog = await openViewAllIfPresent(page);
        if (viewAllDialog) {
          await captureScreenshot(page, testInfo, profileScreenshotPath("disks", profileId, "02-view-all.png"));
          await page.keyboard.press("Escape");
        }
      }
    },
  );

  test(
    "capture configuration screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      test.slow();
      testInfo.setTimeout(240000);
      allowVisualOverflow(testInfo, "Audio mixer controls overflow on narrow screenshot viewport.");
      await page.goto("/config");
      await waitForConnected(page);
      await expect(page.getByRole("heading", { name: "Config" })).toBeVisible();
      await expect.poll(async () => page.locator('[data-testid^="config-category-"]').count()).toBeGreaterThan(0);

      await page.evaluate(() => window.scrollTo(0, 0));
      await captureScreenshot(page, testInfo, "config/01-categories.png");
      await captureConfigSections(page, testInfo);
    },
  );

  test(
    "capture configuration profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      test.slow();
      testInfo.setTimeout(240000);
      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await page.goto("/config");
        await applyDisplayProfileViewport(page, profileId);
        await waitForConnected(page);
        await expect(page.getByRole("heading", { name: "Config" })).toBeVisible();
        await captureScreenshot(page, testInfo, profileScreenshotPath("config", profileId, "01-overview.png"));
      }
    },
  );

  test("capture play screenshots", { tag: "@screenshots" }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installListPreviewLimit(page, 3);
    await page.goto("/play");
    await waitForConnected(page);
    await expect(page.getByRole("heading", { name: "Play Files" })).toBeVisible();
    await expect(getActiveMain(page).getByTestId("playlist-list")).toContainText("intro.sid");

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, "play/01-overview.png");
    await captureLabeledSections(page, testInfo, "play");

    const viewAllDialog = await openViewAllIfPresent(page);
    if (viewAllDialog) {
      await captureScreenshot(page, testInfo, "play/playlist/01-view-all.png");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    await expect(getActiveMain(page).getByTestId("hvsc-controls")).toBeVisible();
  });

  test(
    "capture play profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installListPreviewLimit(page, 3);
      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await applyDisplayProfileViewport(page, profileId);
        await page.getByTestId("tab-play").click();
        await expect(page).toHaveURL(/\/play$/);
        await waitForConnected(page);
        await expect(page.getByRole("heading", { name: "Play Files" })).toBeVisible();
        await captureScreenshot(page, testInfo, profileScreenshotPath("play", profileId, "01-overview.png"));

        const viewAllDialog = await openViewAllIfPresent(page);
        if (viewAllDialog) {
          await captureScreenshot(page, testInfo, profileScreenshotPath("play", profileId, "02-view-all.png"));
          await page.keyboard.press("Escape");
        }
      }
    },
  );

  test(
    "capture import flow screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await page.addInitScript(() => {
        (window as Window & { __c64uDisableLocalAutoConfirm?: boolean }).__c64uDisableLocalAutoConfirm = true;
      });
      await page.goto("/play");

      const dialog = await openImportDialog(page);
      if (!dialog) {
        return;
      }
      const interstitial = await waitForImportInterstitial(dialog);
      if (!interstitial) {
        await captureScreenshot(page, testInfo, "play/import/01-import-interstitial.png");
        return;
      }
      await captureScreenshot(page, testInfo, "play/import/01-import-interstitial.png");

      await interstitial.getByTestId("import-option-c64u").click();
      await expect(dialog.getByTestId("c64u-file-picker")).toBeVisible();
      await captureScreenshot(page, testInfo, "play/import/02-c64u-file-picker.png");

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const localDialog = await openImportDialog(page);
      if (!localDialog) {
        return;
      }
      const localInterstitial = await waitForImportInterstitial(localDialog);
      if (!localInterstitial) {
        await captureScreenshot(page, testInfo, "play/import/03-local-file-picker.png");
        return;
      }
      await localInterstitial.getByTestId("import-option-local").click();
      const input = page.locator('input[type="file"][webkitdirectory]').first();
      await expect(input).toBeAttached();
      await input.setInputFiles([path.resolve("playwright/fixtures/local-play")]);
      await expect(localDialog.getByTestId("local-file-picker")).toBeVisible();
      await captureScreenshot(page, testInfo, "play/import/03-local-file-picker.png");
    },
  );

  test(
    "capture import flow profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await page.addInitScript(() => {
        (window as Window & { __c64uDisableLocalAutoConfirm?: boolean }).__c64uDisableLocalAutoConfirm = true;
      });

      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await page.goto("/play");
        await applyDisplayProfileViewport(page, profileId);

        const dialog = await openImportDialog(page);
        if (!dialog) {
          continue;
        }
        const interstitial = await waitForImportInterstitial(dialog);
        if (!interstitial) {
          await captureScreenshot(
            page,
            testInfo,
            profileScreenshotPath("play/import", profileId, "01-import-interstitial.png"),
          );
          continue;
        }
        await captureScreenshot(
          page,
          testInfo,
          profileScreenshotPath("play/import", profileId, "01-import-interstitial.png"),
        );

        await interstitial.getByTestId("import-option-c64u").click();
        await expect(dialog.getByTestId("c64u-file-picker")).toBeVisible();
        await captureScreenshot(
          page,
          testInfo,
          profileScreenshotPath("play/import", profileId, "02-c64u-file-picker.png"),
        );
        await dialog.getByRole("button", { name: "Cancel" }).click();
      }
    },
  );

  test(
    "capture settings screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await page.goto("/settings");
      await waitForConnected(page);
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, 0));
      await captureScreenshot(page, testInfo, "settings/01-overview.png");
      await capturePageSections(page, testInfo, "settings");
    },
  );

  test(
    "capture settings profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await page.goto("/settings");
        await applyDisplayProfileViewport(page, profileId);
        await waitForConnected(page);
        await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
        await captureScreenshot(page, testInfo, profileScreenshotPath("settings", profileId, "01-overview.png"));
      }
    },
  );

  test(
    "capture diagnostics screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      const openDiagnostics = async () => {
        await page.goto("/");
        await applyDisplayProfileViewport(page, "medium");
        await waitForConnected(page);
        await expect(page.getByTestId("unified-health-badge")).toBeVisible();
        await page.waitForFunction(() =>
          Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces),
        );
        await seedDiagnosticsTraces(page);
        await seedDiagnosticsAnalytics(page);

        const dialog = page.getByRole("dialog", { name: "Diagnostics" });
        if (await dialog.isVisible().catch(() => false)) {
          return dialog;
        }

        const diagnosticsButton = page.getByTestId("unified-health-badge");
        await diagnosticsButton.scrollIntoViewIfNeeded();
        await diagnosticsButton.click();
        await expect(dialog).toBeVisible();
        return dialog;
      };

      const applyEvidenceFilter = async (configure: () => Promise<void>) => {
        await dialog.getByTestId("open-filters-editor").click();
        const filterSurface = page.getByTestId("filters-editor-surface");
        await expect(filterSurface).toBeVisible();
        await filterSurface.getByTestId("quick-filter-reset").click();
        await configure();
        await filterSurface.getByRole("button", { name: "Close" }).click();
        await expect(filterSurface).toBeHidden();
      };

      const applyActivityFilter = applyEvidenceFilter;
      const activityTypesSection = () => page.getByTestId("filters-editor-surface").locator("section").first();
      const activityTypeButton = (label: "Problems" | "Actions" | "Logs" | "Traces") =>
        activityTypesSection().getByRole("button", { name: new RegExp(`^(?:✓\\s+)?${label}$`) });
      const isActivityTypeSelected = async (label: "Problems" | "Actions" | "Logs" | "Traces") => {
        const className = await activityTypeButton(label).evaluate((node) => node.className);
        return className.includes("border-primary");
      };
      const setActivityTypes = async (labels: Array<"Problems" | "Actions" | "Logs" | "Traces">) => {
        const orderedLabels: Array<"Problems" | "Actions" | "Logs" | "Traces"> = [
          "Problems",
          "Actions",
          "Logs",
          "Traces",
        ];
        for (const label of orderedLabels) {
          const isChecked = await isActivityTypeSelected(label);
          const shouldBeChecked = labels.includes(label);
          if (!isChecked && shouldBeChecked) {
            await activityTypeButton(label).click();
          }
        }
        for (const label of orderedLabels) {
          const isChecked = await isActivityTypeSelected(label);
          const shouldBeChecked = labels.includes(label);
          if (isChecked && !shouldBeChecked) {
            await activityTypeButton(label).click();
          }
        }
        await expect
          .poll(async () => {
            const selectedLabels = await Promise.all(
              orderedLabels.map(async (label) => ((await isActivityTypeSelected(label)) ? label : null)),
            );
            return selectedLabels
              .filter((label): label is "Problems" | "Actions" | "Logs" | "Traces" => label !== null)
              .sort()
              .join(",");
          })
          .toBe([...labels].sort().join(","));
      };
      const firstExpandableActivityRow = () => dialog.locator('[data-testid^="evidence-row-"][aria-expanded]').first();
      const activityRowByLabel = (label: string) =>
        dialog.locator('[data-testid^="evidence-row-"][aria-expanded]').filter({ hasText: label }).first();
      const withExpandedDiagnosticsEvidence = async (
        callback: () => Promise<void>,
        options?: {
          hideControls?: boolean;
        },
      ) => {
        await page.evaluate((hideControls: boolean) => {
          const sheet = document.querySelector<HTMLElement>('[data-testid="diagnostics-sheet"]');
          const evidenceList = document.querySelector<HTMLElement>('[data-testid="evidence-list"]');
          const controls = document.querySelector<HTMLElement>('[data-testid="diagnostics-controls"]');
          if (sheet) {
            sheet.dataset.screenshotOverflow = sheet.style.overflow;
            sheet.style.overflow = "visible";
          }
          if (evidenceList) {
            evidenceList.dataset.screenshotMaxHeight = evidenceList.style.maxHeight;
            evidenceList.dataset.screenshotOverflow = evidenceList.style.overflow;
            evidenceList.style.maxHeight = "none";
            evidenceList.style.overflow = "visible";
          }
          if (hideControls && controls) {
            controls.dataset.screenshotDisplay = controls.style.display;
            controls.style.display = "none";
          }
        }, options?.hideControls ?? false);
        try {
          await callback();
        } finally {
          await page.evaluate(() => {
            const sheet = document.querySelector<HTMLElement>('[data-testid="diagnostics-sheet"]');
            const evidenceList = document.querySelector<HTMLElement>('[data-testid="evidence-list"]');
            const controls = document.querySelector<HTMLElement>('[data-testid="diagnostics-controls"]');
            if (sheet) {
              sheet.style.overflow = sheet.dataset.screenshotOverflow ?? "";
              delete sheet.dataset.screenshotOverflow;
            }
            if (evidenceList) {
              evidenceList.style.maxHeight = evidenceList.dataset.screenshotMaxHeight ?? "";
              evidenceList.style.overflow = evidenceList.dataset.screenshotOverflow ?? "";
              delete evidenceList.dataset.screenshotMaxHeight;
              delete evidenceList.dataset.screenshotOverflow;
            }
            if (controls) {
              controls.style.display = controls.dataset.screenshotDisplay ?? "";
              delete controls.dataset.screenshotDisplay;
            }
          });
        }
      };
      const captureExpandedActivityType = async (
        path: string,
        configure: () => Promise<void>,
        options?: {
          rowLabel?: string;
          captureExpandedRowOnly?: boolean;
          unclipDiagnosticsSheet?: boolean;
          hideDiagnosticsControls?: boolean;
          captureLocator?: Locator;
        },
      ) => {
        await applyActivityFilter(configure);
        const row = options?.rowLabel ? activityRowByLabel(options.rowLabel) : firstExpandableActivityRow();
        await expect(row).toBeVisible();
        await row.click();
        await expect(row).toHaveAttribute("aria-expanded", "true");
        await row.evaluate((node) => {
          node.scrollIntoView({ block: "start", inline: "nearest" });
        });
        if (options?.captureExpandedRowOnly) {
          const capture = async () => {
            await captureScreenshot(page, testInfo, `diagnostics/${path}`, { locator: options.captureLocator ?? row });
          };
          if (options.unclipDiagnosticsSheet) {
            await withExpandedDiagnosticsEvidence(capture, {
              hideControls: options.hideDiagnosticsControls,
            });
          } else {
            await capture();
          }
        } else {
          await captureDiagnosticsScreenshot(page, testInfo, path);
        }
        await row.click();
        await expect(row).toHaveAttribute("aria-expanded", "false");
      };

      const dialog = await openDiagnostics();

      await captureDiagnosticsScreenshot(page, testInfo, "01-overview.png");

      await dialog.getByTestId("diagnostics-header-toggle").click();
      await expect(dialog.getByTestId("diagnostics-header-expanded")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "header/01-expanded.png");
      await expect(dialog.getByTestId("health-check-probe-rest")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "header/02-health-check-detail.png");

      await seedLiveDiagnosticsHealthProgress(page);
      await expect(dialog.getByTestId("health-check-probe-config")).toHaveAttribute("data-live-status", "running");
      await expect(dialog.getByTestId("health-check-probe-raster")).toHaveAttribute("data-live-status", "pending");
      await captureDiagnosticsScreenshot(page, testInfo, "header/03-health-check-live-progress.png");
      await clearLiveDiagnosticsHealthProgress(page);
      await seedDiagnosticsAnalytics(page);
      await expect(dialog.getByTestId("health-check-probe-rest")).toBeVisible();

      await dialog.getByTestId("diagnostics-header-toggle").click();
      await expect(dialog.getByTestId("diagnostics-header-expanded")).toBeHidden();

      await captureDiagnosticsScreenshot(page, testInfo, "activity/01-visible-list.png");

      await seedDiagnosticsLogs(page);
      await captureExpandedActivityType("activity/02-expanded-problems.png", async () => {
        await setActivityTypes(["Problems"]);
      });

      await seedDiagnosticsTracesForAction(page, "diagnostics.snapshot");
      await seedDiagnosticsLogs(page);
      await seedDiagnosticsAnalytics(page);
      await captureExpandedActivityType(
        "activity/03-expanded-actions.png",
        async () => {
          await setActivityTypes(["Actions"]);
        },
        {
          rowLabel: "diagnostics.snapshot",
          captureExpandedRowOnly: true,
          unclipDiagnosticsSheet: true,
          hideDiagnosticsControls: true,
        },
      );
      await seedDiagnosticsTraces(page);
      await seedDiagnosticsLogs(page);
      await seedDiagnosticsAnalytics(page);

      await captureExpandedActivityType(
        "activity/04-expanded-logs.png",
        async () => {
          await seedDiagnosticsLogs(page);
          await setActivityTypes(["Logs"]);
        },
        {
          rowLabel: "ERROR FTP disk import failed",
          captureExpandedRowOnly: true,
          unclipDiagnosticsSheet: true,
          hideDiagnosticsControls: true,
        },
      );

      await captureExpandedActivityType("activity/05-expanded-traces.png", async () => {
        await setActivityTypes(["Traces"]);
      });

      await applyActivityFilter(async () => {
        // Reset back to the default Problems + Actions view for collapse evidence.
      });
      const expandableRow = firstExpandableActivityRow();
      await expect(expandableRow).toBeVisible();
      await expandableRow.click();
      await expect(expandableRow).toHaveAttribute("aria-expanded", "true");
      await expandableRow.click();
      await expect(expandableRow).toHaveAttribute("aria-expanded", "false");
      await captureDiagnosticsScreenshot(page, testInfo, "activity/06-collapsed-after-toggle.png");

      await seedDiagnosticsLogs(page);
      await applyActivityFilter(async () => {
        await setActivityTypes(["Problems"]);
      });
      await expect(dialog.getByText("ERROR FTP disk import failed")).toBeVisible();
      await expect(dialog.getByText("GET /v1/runners/script/status")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "activity/07-problems-only.png");

      await seedDiagnosticsLogs(page);
      await applyActivityFilter(async () => {
        await setActivityTypes(["Actions"]);
      });
      await captureDiagnosticsScreenshot(page, testInfo, "activity/08-actions-only.png");

      await applyActivityFilter(async () => {
        await setActivityTypes(["Logs"]);
      });
      await expect(dialog.getByTestId("filters-collapsed-bar")).toContainText("Logs");
      await expect(dialog.getByTestId("filters-collapsed-bar")).not.toContainText("Actions");
      await expect(dialog.getByText("ERROR FTP disk import failed")).toBeVisible();
      await expect(dialog.getByText("WARN Lighting Studio circadian resolution failed")).toBeVisible();
      await expect(dialog.getByText("INFO REST config refresh completed")).toBeVisible();
      await expect(dialog.getByText("DEBUG Cache warmup finished")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "activity/09-logs-only.png");

      await applyActivityFilter(async () => {
        await setActivityTypes(["Traces"]);
      });
      await captureDiagnosticsScreenshot(page, testInfo, "activity/10-traces-only.png");

      await dialog.getByTestId("open-filters-editor").click();
      await expect(page.getByTestId("filters-editor-surface")).toBeVisible();
      await page.getByTestId("filters-editor-surface").getByTestId("quick-filter-errors").click();
      await page.getByTestId("filters-editor-surface").getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("filters-editor-surface")).toBeHidden();
      await captureDiagnosticsScreenshot(page, testInfo, "activity/11-errors-only.png");

      await applyActivityFilter(async () => {
        // Reset back to the default Problems + Actions view before capturing the rest of the surfaces.
      });

      await captureDiagnosticsScreenshot(page, testInfo, "filters/01-summary-bar.png");

      await dialog.getByTestId("diagnostics-device-line").dispatchEvent("pointerdown");
      await dialog.getByTestId("diagnostics-device-line").dispatchEvent("pointerup");
      await expect(page.getByTestId("connection-view-surface")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "connection/01-view.png");

      await page.getByTestId("connection-view-edit").click();
      await expect(page.getByTestId("connection-edit-surface")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "connection/02-edit.png");
      await page.getByTestId("connection-edit-surface").getByRole("button", { name: "Close" }).click();

      await dialog.getByTestId("open-filters-editor").click();
      await expect(page.getByTestId("filters-editor-surface")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "filters/02-editor.png");
      await page.getByTestId("filters-editor-surface").getByRole("button", { name: "Close" }).click();

      await dialog.getByTestId("diagnostics-overflow-menu").click();
      await expect(page.getByTestId("diagnostics-share-all")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "tools/01-menu.png");
      await dialog.getByTestId("diagnostics-overflow-menu").click();
      await expect(page.getByTestId("diagnostics-share-all")).toBeHidden();

      await dialog.getByTestId("open-latency-screen").click();
      await expect(page.getByTestId("latency-analysis-popup")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "analysis/01-latency.png");
      await page.getByTestId("analytic-popup-close").click();

      await dialog.getByTestId("open-timeline-screen").click();
      await expect(page.getByTestId("health-history-popup")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "analysis/02-history.png");
      await page.getByTestId("analytic-popup-close").click();
    },
  );

  test(
    "capture diagnostics profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await page.goto("/");
        await applyDisplayProfileViewport(page, profileId);
        await waitForConnected(page);
        await expect(page.getByTestId("unified-health-badge")).toBeVisible();
        await page.waitForFunction(() =>
          Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces),
        );
        await seedDiagnosticsTraces(page);
        await seedDiagnosticsAnalytics(page);
        const dialog = page.getByRole("dialog", { name: "Diagnostics" });
        if (!(await dialog.isVisible().catch(() => false))) {
          await page.getByTestId("unified-health-badge").click();
          await expect(dialog).toBeVisible();
        }
        if (!(await dialog.isVisible().catch(() => false))) {
          continue;
        }
        await captureDiagnosticsScreenshot(
          page,
          testInfo,
          diagnosticsProfileScreenshotPath(profileId, "01-overview.png"),
          { writeWhenTrackedDuplicate: true },
        );
        await page.keyboard.press("Escape");
      }
    },
  );

  test("capture docs screenshots", { tag: "@screenshots" }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/docs");
    await expect(page).toHaveURL(/\/docs$/);
    await waitForConnected(page);
    await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, "docs/01-overview.png");
    await captureDocsSections(page, testInfo);

    const externalResources = page.getByTestId("docs-external-resources");
    await externalResources.scrollIntoViewIfNeeded();
    await waitForStableRender(page);
    await captureScreenshot(page, testInfo, "docs/external/01-external-resources.png", {
      locator: externalResources,
    });

    for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
      await page.goto("/docs");
      await expect(page).toHaveURL(/\/docs$/);
      await applyDisplayProfileViewport(page, profileId);
      await waitForConnected(page);
      await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();
      const playFilesButton = getActiveSlot(page).locator('button[aria-controls="docs-section-play"]').first();
      await playFilesButton.click();
      await expect(playFilesButton).toHaveAttribute("aria-expanded", "true");
      await waitForStableRender(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await captureScreenshot(page, testInfo, profileScreenshotPath("docs", profileId, "01-overview.png"));
    }
  });

  test(
    "capture demo mode interstitial screenshot",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      allowWarnings(testInfo, "Expected probe failures during offline discovery.");

      await page.addInitScript(() => {
        localStorage.setItem("c64u_startup_discovery_window_ms", "600");
        localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
        localStorage.setItem("c64u_background_rediscovery_interval_ms", "5000");
        localStorage.setItem("c64u_device_host", "127.0.0.1:1");
        localStorage.removeItem("c64u_password");
        localStorage.removeItem("c64u_has_password");
        sessionStorage.removeItem("c64u_demo_interstitial_shown");
        delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
      });

      await page.goto("/", { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog", { name: "Demo Mode" });
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await captureScreenshot(page, testInfo, "home/03-demo-mode-interstitial.png");
      await dialog.getByRole("button", { name: "Continue in Demo Mode" }).click();
      await expect(dialog).toBeHidden();
    },
  );

  test(
    "capture demo mode play screenshot",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.includes("demo.invalid")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"product":""}',
          });
          return;
        }
        await route.continue();
      });

      await page.addInitScript(
        ({ baseUrl }) => {
          localStorage.setItem("c64u_startup_discovery_window_ms", "600");
          localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
          localStorage.setItem("c64u_background_rediscovery_interval_ms", "5000");
          localStorage.setItem("c64u_device_host", "demo.invalid");
          localStorage.removeItem("c64u_password");
          localStorage.removeItem("c64u_has_password");
          delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
          (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = baseUrl;
          (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = baseUrl;
          (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = [
            baseUrl,
            "http://demo.invalid",
          ];
        },
        { baseUrl: server.baseUrl },
      );

      await page.goto("/play", { waitUntil: "domcontentloaded" });
      const demoDialog = page.getByRole("dialog", { name: "Demo Mode" });
      if (await demoDialog.isVisible()) {
        await demoDialog.getByRole("button", { name: "Continue in Demo Mode" }).click();
        await expect(demoDialog).toHaveCount(0);
      }
      await waitForDemoBadge(page);
      await captureScreenshot(page, testInfo, "play/05-demo-mode.png");
    },
  );
});

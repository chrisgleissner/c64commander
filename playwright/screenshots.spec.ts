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
import { getScreenshotFraming, type ScreenshotFramingSurface } from "./screenshotFraming";
import { registerScreenshotSections, sanitizeSegment } from "./screenshotCatalog";
import { planHomeScreenshotSlices, selectCanonicalHomeScreenshotSlices } from "./homeScreenshotLayout";
import { shouldSkipFuzzyScreenshotPrune } from "../scripts/screenshotPrunePolicy.js";
import {
  decideMetadataScreenshotAction,
  decideTrackedScreenshotAction,
  parseGitLsTreeBlobCatalog,
} from "../scripts/screenshotMetadataDedupe.js";
import {
  installFixedClock,
  installListPreviewLimit,
  seedBadgeHealthTraceState,
  installStableStorage,
  seedDiagnosticsAnalytics,
  seedDiagnosticsLogs,
  seedDiagnosticsTracesForAction,
  seedDiagnosticsTraces,
} from "./visualSeeds";

const SCREENSHOT_ROOT = path.resolve("docs/img/app");
const FORCE_REGENERATE_SCREENSHOTS = process.env.SCREENSHOT_FORCE_REGEN === "1";
const execFile = promisify(execFileCb);

const screenshotPath = (relativePath: string) => path.resolve(SCREENSHOT_ROOT, relativePath);

const screenshotLabel = (relativePath: string) => relativePath.replace(/\.[^.]+$/, "").replace(/[\\/]/g, "-");
const screenshotRepoPath = (relativePath: string) => path.posix.join("docs/img/app", relativePath);
const profileScreenshotPath = (pageId: string, profileId: DisplayProfileViewportId, fileName: string) =>
  `${pageId}/profiles/${profileId}/${fileName}`;
const diagnosticsProfileScreenshotPath = (profileId: DisplayProfileViewportId, fileName: string) =>
  `profiles/${profileId}/${fileName}`;
const SCREENSHOT_ARCHIVE_HOST = "archive.test";
const SCREENSHOT_ARCHIVE_QUERY = '(name:"joyride") & (category:apps)';
const SCREENSHOT_ARCHIVE_PRESETS = [
  { type: "category", description: "Category", values: [{ aqlKey: "apps", name: "Apps" }] },
  { type: "type", description: "Type", values: [{ aqlKey: "prg", name: "PRG" }] },
  { type: "sort", description: "Sort", values: [{ aqlKey: "name", name: "Name" }] },
  { type: "order", description: "Order", values: [{ aqlKey: "asc", name: "Ascending" }] },
  { type: "date", description: "Date", values: [{ aqlKey: "2024", name: "2024" }] },
];
const SCREENSHOT_ARCHIVE_RESULTS = [
  { id: "100", category: 40, name: "Joyride", group: "Padua", year: 2024, updated: "2024-03-14" },
  { id: "101", category: 40, name: "Joyride Plus", group: "Onslaught", year: 2025, updated: "2025-01-11" },
];
const SCREENSHOT_HVSC_MODE_KEY = "c64u_hvsc_screenshot_mode";

const installHvscScreenshotMock = async (page: Page) => {
  await page.addInitScript((modeKey: string) => {
    type HvscScreenshotMode = "download-pending" | "ready";
    type HvscSongEntry = {
      id: number;
      virtualPath: string;
      fileName: string;
      durationSeconds: number;
    };

    const listeners: Array<(event: Record<string, unknown>) => void> = [];
    const cancelTokens = new Set<string>();
    const folders = ["/MUSICIANS", "/MUSICIANS/A"];
    const songs: HvscSongEntry[] = [
      {
        id: 1,
        virtualPath: "/MUSICIANS/A/Agemixer/First_Step.sid",
        fileName: "First_Step.sid",
        durationSeconds: 143,
      },
      {
        id: 2,
        virtualPath: "/MUSICIANS/A/Agemixer/Second_Wave.sid",
        fileName: "Second_Wave.sid",
        durationSeconds: 201,
      },
    ];

    const state = {
      installedBaselineVersion: null as number | null,
      installedVersion: 0,
      ingestionState: "idle" as "idle" | "installing" | "ready" | "error",
      ingestionError: null as string | null,
      lastUpdateCheckUtcMs: null as number | null,
      totalSongs: songs.length,
    };

    const readMode = (): HvscScreenshotMode => {
      try {
        return localStorage.getItem(modeKey) === "ready" ? "ready" : "download-pending";
      } catch {
        return "download-pending";
      }
    };

    const emit = (event: Record<string, unknown>) => {
      listeners.forEach((listener) => listener(event));
    };

    const buildStatus = () => ({
      installedBaselineVersion: state.installedBaselineVersion,
      installedVersion: state.installedVersion,
      ingestionState: state.ingestionState,
      lastUpdateCheckUtcMs: state.lastUpdateCheckUtcMs,
      ingestionError: state.ingestionError,
      ingestionSummary:
        state.installedVersion > 0
          ? {
            totalSongs: state.totalSongs,
            ingestedSongs: state.totalSongs,
            failedSongs: 0,
            songlengthSyntaxErrors: 0,
          }
          : null,
    });

    const emitDownloadStart = (ingestionId: string, startedAt: number) => {
      emit({
        ingestionId,
        stage: "download",
        message: "Downloading HVSC archive…",
        percent: 28,
        downloadedBytes: 7340032,
        totalBytes: 26214400,
        elapsedTimeMs: Date.now() - startedAt,
      });
    };

    const emitIngestSuccess = (ingestionId: string, startedAt: number) => {
      emit({
        ingestionId,
        stage: "archive_extraction",
        message: "Extracting SID metadata…",
        processedCount: 1,
        totalCount: songs.length,
        percent: 72,
        elapsedTimeMs: Date.now() - startedAt,
      });
      emit({
        ingestionId,
        stage: "sid_metadata_hydration",
        message: "Hydrating song metadata…",
        processedCount: songs.length,
        totalCount: songs.length,
        percent: 94,
        elapsedTimeMs: Date.now() - startedAt,
      });
      emit({
        ingestionId,
        stage: "complete",
        message: "HVSC ingestion complete",
        percent: 100,
        elapsedTimeMs: Date.now() - startedAt,
      });
    };

    const ensureNotCancelled = (cancelToken?: string) => {
      if (cancelToken && cancelTokens.has(cancelToken)) {
        state.ingestionState = "idle";
        state.ingestionError = "Cancelled";
        throw new Error("HVSC update cancelled");
      }
    };

    window.__hvscMock__ = {
      addListener: (_event: string, listener: (event: Record<string, unknown>) => void) => {
        listeners.push(listener);
        return { remove: async () => { } };
      },
      getHvscStatus: async () => buildStatus(),
      getHvscCacheStatus: async () => ({
        baselineVersion: null,
        updateVersions: [],
      }),
      checkForHvscUpdates: async () => {
        state.lastUpdateCheckUtcMs = Date.now();
        return {
          latestVersion: 84,
          installedVersion: state.installedVersion,
          baselineVersion: null,
          requiredUpdates: state.installedVersion > 0 ? [] : [84],
        };
      },
      installOrUpdateHvsc: async ({ cancelToken }: { cancelToken?: string } = {}) => {
        const mode = readMode();
        const startedAt = Date.now();
        const ingestionId = `screenshot-${startedAt}`;
        state.ingestionState = "installing";
        state.ingestionError = null;
        emit({ ingestionId, stage: "start", message: "HVSC ingestion started", percent: 0, elapsedTimeMs: 0 });
        emitDownloadStart(ingestionId, startedAt);

        if (mode === "download-pending") {
          for (let index = 0; index < 60; index += 1) {
            ensureNotCancelled(cancelToken);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        ensureNotCancelled(cancelToken);
        await new Promise((resolve) => setTimeout(resolve, mode === "ready" ? 80 : 0));
        ensureNotCancelled(cancelToken);

        state.installedBaselineVersion = 84;
        state.installedVersion = 84;
        state.ingestionState = "ready";
        state.ingestionError = null;
        emitIngestSuccess(ingestionId, startedAt);
        return buildStatus();
      },
      cancelHvscInstall: async ({ cancelToken }: { cancelToken?: string } = {}) => {
        if (cancelToken) {
          cancelTokens.add(cancelToken);
        }
        state.ingestionState = "idle";
        state.ingestionError = "Cancelled";
      },
      ingestCachedHvsc: async () => buildStatus(),
      getHvscFolderListing: async ({ path }: { path: string }) => {
        const normalized = path || "/";
        if (normalized === "/") {
          return {
            path: "/",
            folders: ["/MUSICIANS"],
            songs: [],
          };
        }
        if (normalized === "/MUSICIANS") {
          return {
            path: normalized,
            folders: ["/MUSICIANS/A"],
            songs: [],
          };
        }
        if (normalized === "/MUSICIANS/A") {
          return {
            path: normalized,
            folders,
            songs: songs.map((song) => ({
              id: song.id,
              virtualPath: song.virtualPath,
              fileName: song.fileName,
              durationSeconds: song.durationSeconds,
            })),
          };
        }
        return {
          path: normalized,
          folders: [],
          songs: [],
        };
      },
      getHvscSong: async ({ id, virtualPath }: { id?: number; virtualPath?: string } = {}) => {
        const match = songs.find((song) => song.id === id || song.virtualPath === virtualPath);
        if (!match) {
          throw new Error("Song not found");
        }
        return {
          ...match,
          dataBase64: "",
        };
      },
      getHvscDurationByMd5: async () => ({ durationSeconds: 143 }),
    };
  }, SCREENSHOT_HVSC_MODE_KEY);
};

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

const seedSwitchDeviceHealthSnapshot = async (page: Page, scenario: "progress" | "all-healthy" | "mixed-unhealthy") => {
  await page.waitForFunction(() => typeof window.__c64uDiagnosticsTestBridge?.seedSavedDeviceHealth === "function");
  await page.evaluate((selectedScenario) => {
    const bridge = window.__c64uDiagnosticsTestBridge;
    const probeOrder = ["REST", "FTP", "TELNET", "CONFIG", "RASTER", "JIFFY"] as const;
    const startedAt = new Date(Date.now() - 7_000).toISOString();
    const cycleStartedAt = new Date(Date.now() - 9_000).toISOString();
    const lastCompletedAt = new Date(Date.now() - 19_000).toISOString();
    const completedStartedAt = new Date(Date.now() - 42_000).toISOString();
    const completedEndedAt = new Date(Date.now() - 38_000).toISOString();

    const buildPendingProbeStates = () =>
      Object.fromEntries(
        probeOrder.map((probe) => [
          probe,
          {
            state: "PENDING",
            outcome: null,
            startedAt: null,
            endedAt: null,
            durationMs: null,
            reason: null,
          },
        ]),
      );

    const buildProbeStates = (
      completed: Partial<
        Record<
          (typeof probeOrder)[number],
          { outcome: "Success" | "Skipped"; durationMs: number | null; reason: string | null }
        >
      >,
      runningProbe: (typeof probeOrder)[number],
    ) => {
      return Object.fromEntries(
        probeOrder.map((probe, index) => {
          const completedProbe = completed[probe];
          if (completedProbe) {
            return [
              probe,
              {
                state: completedProbe.outcome === "Skipped" ? "CANCELLED" : "SUCCESS",
                outcome: completedProbe.outcome,
                startedAt,
                endedAt: startedAt,
                durationMs: completedProbe.durationMs,
                reason: completedProbe.reason,
              },
            ];
          }
          if (probe === runningProbe) {
            return [
              probe,
              {
                state: "RUNNING",
                outcome: null,
                startedAt,
                endedAt: null,
                durationMs: null,
                reason: null,
              },
            ];
          }
          return [
            probe,
            {
              state: "PENDING",
              outcome: null,
              startedAt: null,
              endedAt: null,
              durationMs: null,
              reason: null,
            },
          ];
        }),
      );
    };

    const buildLiveProbes = (
      completed: Partial<
        Record<
          (typeof probeOrder)[number],
          { outcome: "Success" | "Skipped"; durationMs: number | null; reason: string | null }
        >
      >,
    ) => {
      return Object.fromEntries(
        Object.entries(completed).map(([probe, record], index) => [
          probe,
          {
            probe,
            outcome: record.outcome,
            durationMs: record.durationMs,
            reason: record.reason,
            startMs: Date.now() - 1_000 + index * 40,
          },
        ]),
      );
    };

    const buildCompletedResult = ({
      runId,
      overallHealth,
      product,
      probes,
    }: {
      runId: string;
      overallHealth: "Healthy" | "Degraded" | "Unhealthy" | "Unavailable";
      product: string;
      probes: Record<
        (typeof probeOrder)[number],
        { outcome: "Success" | "Skipped" | "Fail"; durationMs: number | null; reason: string | null }
      >;
    }) => ({
      runId,
      startTimestamp: completedStartedAt,
      endTimestamp: completedEndedAt,
      totalDurationMs: 4_000,
      overallHealth,
      connectivity: "Online",
      probes: Object.fromEntries(
        probeOrder.map((probe, index) => [
          probe,
          {
            probe,
            outcome: probes[probe].outcome,
            durationMs: probes[probe].durationMs,
            reason: probes[probe].reason,
            startMs: Date.now() - 8_000 + index * 30,
          },
        ]),
      ),
      latency: { p50: 62, p90: 118, p99: 181 },
      deviceInfo: {
        firmware: "3.11",
        fpga: "1.42",
        core: "C64",
        uptimeSeconds: 256,
        product,
      },
    });

    const buildHealthyResult = (runId: string, product: string) =>
      buildCompletedResult({
        runId,
        overallHealth: "Healthy",
        product,
        probes: {
          REST: { outcome: "Success", durationMs: 54, reason: null },
          FTP: { outcome: "Success", durationMs: 88, reason: null },
          TELNET: { outcome: "Success", durationMs: 119, reason: null },
          CONFIG: { outcome: "Skipped", durationMs: null, reason: "Passive" },
          RASTER: { outcome: "Success", durationMs: 35, reason: null },
          JIFFY: { outcome: "Success", durationMs: 41, reason: null },
        },
      });

    const buildUnhealthyResult = (runId: string, product: string) =>
      buildCompletedResult({
        runId,
        overallHealth: "Unhealthy",
        product,
        probes: {
          REST: { outcome: "Success", durationMs: 61, reason: null },
          FTP: { outcome: "Fail", durationMs: 240, reason: "FTP timeout" },
          TELNET: { outcome: "Success", durationMs: 122, reason: null },
          CONFIG: { outcome: "Skipped", durationMs: null, reason: "Passive" },
          RASTER: { outcome: "Fail", durationMs: 211, reason: "Raster probe mismatch" },
          JIFFY: { outcome: "Success", durationMs: 48, reason: null },
        },
      });

    if (selectedScenario === "all-healthy") {
      bridge?.seedSavedDeviceHealth({
        cycle: {
          running: false,
          lastStartedAt: completedStartedAt,
          lastCompletedAt: completedEndedAt,
        },
        byDeviceId: {
          "device-c64u-primary": {
            running: false,
            latestResult: buildHealthyResult("hcr-picker-healthy-1", "Commodore 64 Ultimate"),
            liveProbes: null,
            probeStates: buildPendingProbeStates(),
            lastStartedAt: completedStartedAt,
            lastCompletedAt: completedEndedAt,
            error: null,
          },
          "device-c64u-secondary": {
            running: false,
            latestResult: buildHealthyResult("hcr-picker-healthy-2", "Commodore 64 Ultimate"),
            liveProbes: null,
            probeStates: buildPendingProbeStates(),
            lastStartedAt: completedStartedAt,
            lastCompletedAt: completedEndedAt,
            error: null,
          },
          "device-c64u-custom": {
            running: false,
            latestResult: buildHealthyResult("hcr-picker-healthy-3", "Commodore 64 Ultimate"),
            liveProbes: null,
            probeStates: buildPendingProbeStates(),
            lastStartedAt: completedStartedAt,
            lastCompletedAt: completedEndedAt,
            error: null,
          },
        },
      });
      return;
    }

    if (selectedScenario === "mixed-unhealthy") {
      bridge?.seedSavedDeviceHealth({
        cycle: {
          running: false,
          lastStartedAt: completedStartedAt,
          lastCompletedAt: completedEndedAt,
        },
        byDeviceId: {
          "device-c64u-primary": {
            running: false,
            latestResult: buildHealthyResult("hcr-picker-mixed-1", "Commodore 64 Ultimate"),
            liveProbes: null,
            probeStates: buildPendingProbeStates(),
            lastStartedAt: completedStartedAt,
            lastCompletedAt: completedEndedAt,
            error: null,
          },
          "device-c64u-secondary": {
            running: false,
            latestResult: buildHealthyResult("hcr-picker-mixed-2", "Commodore 64 Ultimate"),
            liveProbes: null,
            probeStates: buildPendingProbeStates(),
            lastStartedAt: completedStartedAt,
            lastCompletedAt: completedEndedAt,
            error: null,
          },
          "device-c64u-custom": {
            running: false,
            latestResult: buildUnhealthyResult("hcr-picker-mixed-3", "Commodore 64 Ultimate"),
            liveProbes: null,
            probeStates: buildPendingProbeStates(),
            lastStartedAt: completedStartedAt,
            lastCompletedAt: completedEndedAt,
            error: null,
          },
        },
      });
      return;
    }

    bridge?.seedSavedDeviceHealth({
      cycle: {
        running: true,
        lastStartedAt: cycleStartedAt,
        lastCompletedAt,
      },
      byDeviceId: {
        "device-c64u-primary": {
          running: true,
          latestResult: null,
          liveProbes: buildLiveProbes({
            REST: { outcome: "Success", durationMs: 54, reason: null },
          }),
          probeStates: buildProbeStates(
            {
              REST: { outcome: "Success", durationMs: 54, reason: null },
            },
            "FTP",
          ),
          lastStartedAt: startedAt,
          lastCompletedAt: null,
          error: null,
        },
        "device-c64u-secondary": {
          running: true,
          latestResult: null,
          liveProbes: buildLiveProbes({
            REST: { outcome: "Success", durationMs: 48, reason: null },
            FTP: { outcome: "Success", durationMs: 83, reason: null },
            TELNET: { outcome: "Success", durationMs: 121, reason: null },
          }),
          probeStates: buildProbeStates(
            {
              REST: { outcome: "Success", durationMs: 48, reason: null },
              FTP: { outcome: "Success", durationMs: 83, reason: null },
              TELNET: { outcome: "Success", durationMs: 121, reason: null },
            },
            "CONFIG",
          ),
          lastStartedAt: startedAt,
          lastCompletedAt: null,
          error: null,
        },
        "device-c64u-custom": {
          running: true,
          latestResult: null,
          liveProbes: buildLiveProbes({
            REST: { outcome: "Success", durationMs: 50, reason: null },
            FTP: { outcome: "Success", durationMs: 72, reason: null },
            TELNET: { outcome: "Success", durationMs: 118, reason: null },
            CONFIG: { outcome: "Skipped", durationMs: null, reason: "Passive" },
            RASTER: { outcome: "Success", durationMs: 37, reason: null },
          }),
          probeStates: buildProbeStates(
            {
              REST: { outcome: "Success", durationMs: 50, reason: null },
              FTP: { outcome: "Success", durationMs: 72, reason: null },
              TELNET: { outcome: "Success", durationMs: 118, reason: null },
              CONFIG: { outcome: "Skipped", durationMs: null, reason: "Passive" },
              RASTER: { outcome: "Success", durationMs: 37, reason: null },
            },
            "JIFFY",
          ),
          lastStartedAt: startedAt,
          lastCompletedAt: null,
          error: null,
        },
      },
    });
  }, scenario);
};

const seedSwitchDeviceHealthProgress = async (page: Page) => {
  await seedSwitchDeviceHealthSnapshot(page, "progress");
};

const seedSwitchDeviceHealthAllHealthy = async (page: Page) => {
  await seedSwitchDeviceHealthSnapshot(page, "all-healthy");
};

const seedSwitchDeviceHealthMixedUnhealthy = async (page: Page) => {
  await seedSwitchDeviceHealthSnapshot(page, "mixed-unhealthy");
};

const ensureScreenshotDir = async (filePath: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

interface HeadScreenshotCatalog {
  blobIdsToPaths: Map<string, string[]>;
  pathBlobIds: Map<string, string>;
  trackedPaths: Set<string>;
}

let headScreenshotCatalogPromise: Promise<HeadScreenshotCatalog> | null = null;
const headScreenshotBufferPromises = new Map<string, Promise<Buffer | null>>();

const loadHeadScreenshotCatalog = async (): Promise<HeadScreenshotCatalog> => {
  if (!headScreenshotCatalogPromise) {
    headScreenshotCatalogPromise = (async () => {
      try {
        const { stdout } = await execFile("git", ["ls-tree", "-r", "HEAD", "--", "docs/img/app"], {
          maxBuffer: 8 * 1024 * 1024,
        });
        return parseGitLsTreeBlobCatalog(stdout);
      } catch (error) {
        console.warn("Failed to build tracked screenshot catalog from HEAD.", error);
        return {
          blobIdsToPaths: new Map<string, string[]>(),
          pathBlobIds: new Map<string, string>(),
          trackedPaths: new Set<string>(),
        };
      }
    })();
  }

  return headScreenshotCatalogPromise;
};

const hashScreenshotFile = async (filePath: string) => {
  const { stdout } = await execFile("git", ["hash-object", filePath], {
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
};

const loadHeadScreenshotBuffer = async (repoPath: string) => {
  let pending = headScreenshotBufferPromises.get(repoPath);
  if (!pending) {
    pending = execFile("git", ["show", `HEAD:${repoPath}`], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    })
      .then(({ stdout }) => stdout)
      .catch((error) => {
        console.warn(`Failed to load tracked screenshot ${repoPath} from HEAD.`, error);
        return null;
      });
    headScreenshotBufferPromises.set(repoPath, pending);
  }
  return pending;
};

const waitForStableRender = async (page: Page) => {
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => (document as any).fonts?.ready ?? true);
  await page.waitForFunction(() => {
    const runway = document.querySelector('[data-testid="swipe-navigation-runway"]');
    if (!(runway instanceof HTMLElement)) return true;
    return runway.dataset.runwayPhase !== "transitioning";
  });
  await page.waitForFunction(() => {
    const animations = document.getAnimations();
    return animations.every((animation) => {
      if (animation.playState !== "running") return true;
      const timing = animation.effect?.getComputedTiming();
      return timing?.iterations === Infinity;
    });
  });
  await page.evaluate(async () => {
    const readVisualState = () => {
      const activeSlot = document.querySelector('[data-slot-active="true"]');
      const slot = activeSlot instanceof HTMLElement ? activeSlot : null;
      const scroller =
        slot ??
        (document.scrollingElement instanceof HTMLElement
          ? document.scrollingElement
          : document.documentElement instanceof HTMLElement
            ? document.documentElement
            : null);
      const rect = slot?.getBoundingClientRect() ?? null;
      return {
        runwayPhase:
          document.querySelector('[data-testid="swipe-navigation-runway"]') instanceof HTMLElement
            ? ((document.querySelector('[data-testid="swipe-navigation-runway"]') as HTMLElement).dataset.runwayPhase ??
              "idle")
            : "idle",
        scrollTop: scroller?.scrollTop ?? window.scrollY,
        scrollLeft: scroller?.scrollLeft ?? window.scrollX,
        rectTop: rect?.top ?? 0,
        rectLeft: rect?.left ?? 0,
        rectWidth: rect?.width ?? window.innerWidth,
        rectHeight: rect?.height ?? window.innerHeight,
      };
    };

    const isStable = (previous: ReturnType<typeof readVisualState>, next: ReturnType<typeof readVisualState>) =>
      previous.runwayPhase === "idle" &&
      next.runwayPhase === "idle" &&
      previous.scrollTop === next.scrollTop &&
      previous.scrollLeft === next.scrollLeft &&
      previous.rectTop === next.rectTop &&
      previous.rectLeft === next.rectLeft &&
      previous.rectWidth === next.rectWidth &&
      previous.rectHeight === next.rectHeight;

    let stableFrames = 0;
    let previous = readVisualState();

    while (stableFrames < 4) {
      await new Promise<void>(requestAnimationFrame);
      const next = readVisualState();
      stableFrames = isStable(previous, next) ? stableFrames + 1 : 0;
      previous = next;
    }
  });
  // Let the compositor finish any residual cross-fade/transform cleanup after the
  // DOM, animation, and scroll state have already settled.
  await page.waitForTimeout(200);
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
  await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => { });
  if (!(await dialog.isVisible().catch(() => false))) {
    return null;
  }
  return dialog;
};

const waitForImportInterstitial = async (dialog: ReturnType<Page["getByRole"]>) => {
  const interstitial = dialog.getByTestId("import-selection-interstitial");
  await interstitial.waitFor({ state: "visible", timeout: 3000 }).catch(() => { });
  if (await interstitial.isVisible().catch(() => false)) {
    return interstitial;
  }
  return null;
};

const seedArchiveSearchMock = async (page: Page) => {
  await page.addInitScript((archiveHost: string) => {
    localStorage.setItem("c64u_archive_host_override", archiveHost);
  }, SCREENSHOT_ARCHIVE_HOST);

  await page.route(`http://${SCREENSHOT_ARCHIVE_HOST}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers, body: "" });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/leet/search/aql/presets") {
      await route.fulfill({
        status: 200,
        headers,
        contentType: "application/json",
        body: JSON.stringify(SCREENSHOT_ARCHIVE_PRESETS),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/leet/search/aql") {
      const query = url.searchParams.get("query") ?? "";
      await route.fulfill({
        status: 200,
        headers,
        contentType: "application/json",
        body: JSON.stringify(query === SCREENSHOT_ARCHIVE_QUERY ? SCREENSHOT_ARCHIVE_RESULTS : []),
      });
      return;
    }

    await route.fulfill({ status: 404, headers, body: "not found" });
  });
};

const setHvscScreenshotMode = async (page: Page, mode: "download-pending" | "ready") => {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: SCREENSHOT_HVSC_MODE_KEY, value: mode },
  );
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

const captureFramedScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  relativePath: string,
  surface: ScreenshotFramingSurface,
  options?: {
    fullPage?: boolean;
    locator?: Locator;
    borderPx?: number;
    borderColor?: { r: number; g: number; b: number; alpha?: number };
    writeWhenTrackedDuplicate?: boolean;
    skipFuzzyHeadRestore?: boolean;
  },
) => {
  if (getScreenshotFraming(surface) === "surface") {
    await captureScreenshot(page, testInfo, relativePath, options);
    return;
  }

  const { locator: _locator, ...rest } = options ?? {};
  await captureScreenshot(page, testInfo, relativePath, Object.keys(rest).length > 0 ? rest : undefined);
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
    skipFuzzyHeadRestore?: boolean;
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
  const skipTrackedDuplicatePrune = !FORCE_REGENERATE_SCREENSHOTS && shouldSkipFuzzyScreenshotPrune(repoPath);
  const headBlobId = catalog.pathBlobIds.get(repoPath);

  if (!FORCE_REGENERATE_SCREENSHOTS && headBlobId) {
    try {
      const headPngBuffer = await loadHeadScreenshotBuffer(repoPath);
      const { action } = await decideTrackedScreenshotAction({
        currentPngBuffer: screenshotBuffer,
        headPngBuffer,
        skipFuzzyHeadRestore: skipTrackedDuplicatePrune,
      });

      if (action === "restore-head") {
        await execFile("git", ["restore", "--source=HEAD", "--worktree", "--", repoPath]);
        await attachStepScreenshot(page, testInfo, screenshotLabel(relativePath));
        return;
      }
    } catch (error) {
      console.warn(`[screenshots] Pixel dedupe failed for ${relativePath}.`, error);
    }
  }

  await fs.writeFile(filePath, screenshotBuffer);

  if (FORCE_REGENERATE_SCREENSHOTS) {
    await attachStepScreenshot(page, testInfo, screenshotLabel(relativePath));
    return;
  }

  try {
    const currentBlobId = await hashScreenshotFile(filePath);
    const action = decideMetadataScreenshotAction({
      repoPath,
      currentBlobId,
      headBlobId,
      trackedPathsForBlobId: catalog.blobIdsToPaths.get(currentBlobId) ?? [],
      writeWhenTrackedDuplicate: options?.writeWhenTrackedDuplicate ?? false,
      skipTrackedDuplicatePrune,
    });

    if (action === "restore-head") {
      await execFile("git", ["restore", "--source=HEAD", "--worktree", "--", repoPath]);
    } else if (action === "delete-new") {
      await fs.rm(filePath, { force: true });
      console.info(`[screenshots] Removed ${relativePath}; bytes match an existing tracked screenshot.`);
    }
  } catch (error) {
    console.warn(`[screenshots] Metadata dedupe failed for ${relativePath}.`, error);
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
    await captureFramedScreenshot(
      page,
      testInfo,
      `docs/sections/${String(order).padStart(2, "0")}-${slug}.png`,
      "docs-section",
      {
        locator: card,
      },
    );
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
  await waitForStableRender(page);
  const layout = await page.evaluate(() => {
    const activeSlot = document.querySelector('[data-slot-active="true"]');
    const activeMain =
      activeSlot?.querySelector('[data-page-scroll-container="true"]') ?? activeSlot?.querySelector("main");
    const slotElement = activeSlot instanceof HTMLElement ? activeSlot : null;
    const scrollElement = activeMain instanceof HTMLElement ? activeMain : slotElement;
    const scrollRect = scrollElement?.getBoundingClientRect() ?? null;
    const sections = Array.from(activeMain?.querySelectorAll("[data-section-label]") ?? [])
      .map((node) => {
        const label = node.getAttribute("data-section-label")?.trim() ?? "";
        const rect = node.getBoundingClientRect();
        return {
          label,
          top: scrollRect ? rect.top - scrollRect.top + scrollElement!.scrollTop : rect.top + window.scrollY,
          bottom: scrollRect ? rect.bottom - scrollRect.top + scrollElement!.scrollTop : rect.bottom + window.scrollY,
        };
      })
      .filter((section) => section.label.length > 0 && section.bottom > section.top);

    const rootStyle = getComputedStyle(document.documentElement);
    const main = activeMain;
    const mainStyle = main ? getComputedStyle(main) : null;
    const appBarHeight = Number.parseFloat(rootStyle.getPropertyValue("--app-bar-height")) || 0;
    const bottomInset = Number.parseFloat(mainStyle?.paddingBottom ?? "0") || 0;
    const viewportHeight = scrollElement?.clientHeight ?? window.innerHeight;
    const maxScroll = scrollElement ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight) : 0;

    return {
      sections,
      viewportHeight,
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

  const canonicalSlices = selectCanonicalHomeScreenshotSlices(slices);

  for (let index = 0; index < canonicalSlices.length; index += 1) {
    const { fileName, slice } = canonicalSlices[index];
    await page.evaluate((nextScrollTop) => {
      const activeSlot = document.querySelector<HTMLElement>('[data-slot-active="true"]');
      const scrollContainer =
        activeSlot?.querySelector<HTMLElement>('[data-page-scroll-container="true"]') ?? activeSlot ?? null;
      if (scrollContainer) {
        scrollContainer.scrollTop = nextScrollTop;
      }
    }, slice.scrollTop);
    await waitForStableRender(page);
    await captureScreenshot(page, testInfo, `home/sections/${fileName}`);
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

  await page
    .waitForFunction(
      () => Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces),
      undefined,
      { timeout: 3000 },
    )
    .catch(() => null);
  await seedBadgeHealthTraceState(page, { health: "Healthy", problemCount: 0 });
  await expect(page.locator('[data-slot-active="true"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-health-state",
    "Healthy",
    { timeout: 5000 },
  );
};

const getActiveHealthBadge = (page: Page) =>
  page.locator('[data-slot-active="true"]').getByTestId("unified-health-badge");

const waitForDemoBadge = async (page: Page) => {
  await expect(getActiveHealthBadge(page)).toHaveAttribute("data-connectivity-state", "Demo", { timeout: 10000 });
};

const getActiveSlot = (page: Page) => page.locator('[data-slot-active="true"]');

const getActiveMain = (page: Page) => getActiveSlot(page).locator("main");

const installSavedDeviceScreenshotState = async (page: Page, baseUrlArg: string, includeDiskReference = false) => {
  await page.addInitScript(
    ({ baseUrlArg: targetBaseUrl, includeDiskReference: withDiskReference }) => {
      const baseUrl = new URL(targetBaseUrl);
      const resolvedHost = baseUrl.hostname;
      const resolvedPort = Number(baseUrl.port || "80");

      localStorage.setItem(
        "c64u_saved_devices:v1",
        JSON.stringify({
          version: 1,
          selectedDeviceId: "device-c64u-primary",
          devices: [
            {
              id: "device-c64u-primary",
              name: "",
              nameSource: "auto",
              host: resolvedHost,
              httpPort: resolvedPort,
              ftpPort: 21,
              telnetPort: 23,
              lastKnownProduct: "C64U",
              lastKnownHostname: "c64u-primary",
              lastKnownUniqueId: "UID-C64U-1",
              lastSuccessfulConnectionAt: "2026-04-10T12:00:00.000Z",
              lastUsedAt: "2026-04-10T12:00:00.000Z",
              hasPassword: false,
            },
            {
              id: "device-c64u-secondary",
              name: "",
              nameSource: "auto",
              host: resolvedHost,
              httpPort: resolvedPort,
              ftpPort: 2021,
              telnetPort: 2323,
              lastKnownProduct: "C64U",
              lastKnownHostname: "c64u-secondary",
              lastKnownUniqueId: "UID-C64U-2",
              lastSuccessfulConnectionAt: "2026-04-10T11:55:00.000Z",
              lastUsedAt: null,
              hasPassword: false,
            },
            {
              id: "device-c64u-custom",
              name: "C64U FE",
              nameSource: "custom",
              host: resolvedHost,
              httpPort: resolvedPort,
              ftpPort: 2121,
              telnetPort: 2324,
              lastKnownProduct: "C64U",
              lastKnownHostname: "studio-c64",
              lastKnownUniqueId: "UID-C64U-1",
              lastSuccessfulConnectionAt: "2026-04-10T11:50:00.000Z",
              lastUsedAt: null,
              hasPassword: false,
            },
          ],
          summaries: {
            "device-c64u-primary": {
              deviceId: "device-c64u-primary",
              verifiedAt: "2026-04-10T12:00:00.000Z",
              lastHealthState: "Healthy",
              lastConnectivityState: "Online",
              lastProbeSucceededAt: "2026-04-10T12:00:00.000Z",
              lastProbeFailedAt: null,
              lastVerifiedProduct: "C64U",
              lastVerifiedHostname: "c64u-primary",
              lastVerifiedUniqueId: "UID-C64U-1",
            },
            "device-c64u-secondary": {
              deviceId: "device-c64u-secondary",
              verifiedAt: "2026-04-10T11:55:00.000Z",
              lastHealthState: "Healthy",
              lastConnectivityState: "Online",
              lastProbeSucceededAt: "2026-04-10T11:55:00.000Z",
              lastProbeFailedAt: null,
              lastVerifiedProduct: "C64U",
              lastVerifiedHostname: "c64u-secondary",
              lastVerifiedUniqueId: "UID-C64U-2",
            },
            "device-c64u-custom": {
              deviceId: "device-c64u-custom",
              verifiedAt: "2026-04-10T11:50:00.000Z",
              lastHealthState: "Healthy",
              lastConnectivityState: "Online",
              lastProbeSucceededAt: "2026-04-10T11:50:00.000Z",
              lastProbeFailedAt: null,
              lastVerifiedProduct: "C64U",
              lastVerifiedHostname: "studio-c64",
              lastVerifiedUniqueId: "UID-C64U-1",
            },
          },
          summaryLru: ["device-c64u-primary", "device-c64u-secondary", "device-c64u-custom"],
        }),
      );

      if (withDiskReference) {
        localStorage.setItem(
          "c64u_disk_library:screenshot-seed",
          JSON.stringify({
            disks: [
              {
                id: "disk-seeded-1",
                name: "Demo Disk",
                origin: {
                  sourceKind: "ultimate",
                  originDeviceId: "device-c64u-primary",
                  originDeviceUniqueId: "UID-C64U-1",
                  originPath: "/disks/demo.d64",
                },
              },
            ],
          }),
        );
      }
    },
    { baseUrlArg, includeDiskReference },
  );
};

const seedDiagnosticsLogsForDeviceFiltering = async (page: Page) => {
  await page.evaluate(
    (seedLogs) => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          window.clearTimeout(timeout);
          window.removeEventListener("c64u-logs-updated", handler);
          setTimeout(resolve, 50);
        };
        const timeout = window.setTimeout(() => {
          window.removeEventListener("c64u-logs-updated", handler);
          resolve();
        }, 250);
        window.addEventListener("c64u-logs-updated", handler);
        localStorage.setItem("c64u_app_logs", JSON.stringify(seedLogs));
        window.dispatchEvent(new CustomEvent("c64u-logs-updated"));
      });
    },
    [
      {
        id: "log-device-primary",
        level: "info",
        message: "Primary C64U log",
        timestamp: "2024-03-20T12:21:00.000Z",
        device: {
          savedDeviceId: "device-c64u-primary",
          savedDeviceNameSnapshot: "C64U",
          savedDeviceHostSnapshot: "c64u-primary",
          verifiedUniqueId: "UID-C64U-1",
          verifiedHostname: "c64u-primary",
          verifiedProduct: "C64U",
        },
      },
      {
        id: "log-device-secondary",
        level: "warn",
        message: "Secondary rack drift detected",
        timestamp: "2024-03-20T12:22:00.000Z",
        device: {
          savedDeviceId: "device-c64u-secondary",
          savedDeviceNameSnapshot: "c64u-secondary",
          savedDeviceHostSnapshot: "c64u-secondary",
          verifiedUniqueId: "UID-C64U-2",
          verifiedHostname: "c64u-secondary",
          verifiedProduct: "C64U",
        },
      },
      {
        id: "log-device-custom",
        level: "error",
        message: "Custom lab import failed",
        timestamp: "2024-03-20T12:23:00.000Z",
        device: {
          savedDeviceId: "device-c64u-custom",
          savedDeviceNameSnapshot: "C64U FE",
          savedDeviceHostSnapshot: "studio-c64",
          verifiedUniqueId: "UID-C64U-1",
          verifiedHostname: "studio-c64",
          verifiedProduct: "C64U",
        },
      },
      {
        id: "log-device-legacy",
        level: "info",
        message: "Legacy unattributed log",
        timestamp: "2024-03-20T12:24:00.000Z",
      },
    ],
  );
};

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
    await captureScreenshot(page, testInfo, "home/00-overview-light.png");
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
    await expect(getActiveHealthBadge(page)).toContainText("C64U");
    await captureScreenshot(page, testInfo, "home/02-connection-status-popover.png", {
      locator: getActiveHealthBadge(page),
    });
    await captureHomeSections(page, testInfo);
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

      await captureScreenshot(page, testInfo, "home/dialogs/05-lighting-studio-medium.png");

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
      await seedArchiveSearchMock(page);
      await page.goto("/play");
      await waitForConnected(page);
      await expect(page.getByRole("heading", { name: "Play Files" })).toBeVisible();

      const dialog = await openImportDialog(page);
      expect(dialog, "Add items dialog should open before capturing import screenshots").not.toBeNull();
      const interstitial = await waitForImportInterstitial(dialog);
      expect(
        interstitial,
        "Import source interstitial should be visible before capturing import screenshots",
      ).not.toBeNull();
      await captureScreenshot(page, testInfo, "play/import/01-import-interstitial.png", { skipFuzzyHeadRestore: true });

      await interstitial.getByTestId("import-option-c64u").click();
      await expect(dialog.getByTestId("c64u-file-picker")).toBeVisible();
      await expect(dialog.getByTestId("add-items-selection-heading")).toHaveText("From C64U");
      await captureScreenshot(page, testInfo, "play/import/02-c64u-file-picker.png", { skipFuzzyHeadRestore: true });

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const localDialog = await openImportDialog(page);
      expect(localDialog, "Add items dialog should reopen for the local import screenshot").not.toBeNull();
      const localInterstitial = await waitForImportInterstitial(localDialog);
      expect(
        localInterstitial,
        "Import source interstitial should be visible before capturing local import",
      ).not.toBeNull();
      await localInterstitial.getByTestId("import-option-local").click();
      const input = page.locator('input[type="file"][webkitdirectory]').first();
      await expect(input).toBeAttached();
      await input.setInputFiles([path.resolve("playwright/fixtures/local-play")]);
      await expect(localDialog.getByTestId("local-file-picker")).toBeVisible();
      await expect(localDialog.getByTestId("add-items-selection-heading")).toHaveText("From Local");
      await captureScreenshot(page, testInfo, "play/import/03-local-file-picker.png", { skipFuzzyHeadRestore: true });

      await localDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const archiveDialog = await openImportDialog(page);
      expect(archiveDialog, "Add items dialog should reopen for the CommoServe screenshot").not.toBeNull();
      const archiveInterstitial = await waitForImportInterstitial(archiveDialog);
      expect(
        archiveInterstitial,
        "Import source interstitial should be visible before capturing CommoServe import",
      ).not.toBeNull();

      await archiveInterstitial.getByTestId("import-option-commoserve").click();
      const archivePicker = archiveDialog.getByTestId("commoserve-picker");
      await expect(archivePicker).toBeVisible();
      await archivePicker.getByLabel("Name").fill("joyride");
      const categoryTrigger = archivePicker.getByRole("combobox").nth(0);
      await categoryTrigger.click();
      const categoryOption = page.getByRole("option", { name: "Apps" });
      await expect(categoryOption).toBeVisible();
      await categoryOption.evaluate((node) => {
        if (node instanceof HTMLElement) {
          node.click();
        }
      });
      await expect(categoryTrigger).toContainText("Apps");
      await expect(archivePicker.getByTestId("archive-query-preview")).toContainText(SCREENSHOT_ARCHIVE_QUERY);
      await expect(archiveDialog.getByTestId("add-items-selection-heading")).toHaveText("From CommoServe");
      await captureScreenshot(page, testInfo, "play/import/04-commoserve-search.png", { skipFuzzyHeadRestore: true });

      await archivePicker.getByTestId("archive-search-button").click();
      await expect(archivePicker.getByTestId("archive-result-row")).toHaveCount(2);
      await archivePicker.getByRole("checkbox", { name: /^Select Joyride$/ }).click();
      await expect(archiveDialog.getByTestId("add-items-selection-count")).toHaveText(/1 selected/i);
      await expect(archiveDialog.getByTestId("add-items-selection-heading")).toHaveText("From CommoServe");
      await captureScreenshot(page, testInfo, "play/import/05-commoserve-results-selected.png", {
        skipFuzzyHeadRestore: true,
      });
    },
  );

  test(
    "capture hvsc import screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installHvscScreenshotMock(page);
      await setHvscScreenshotMode(page, "download-pending");

      await page.goto("/play");
      await waitForConnected(page);
      await expect(page.getByRole("heading", { name: "Play Files" })).toBeVisible();

      const firstDialog = await openImportDialog(page);
      expect(firstDialog, "Add items dialog should open before capturing the first HVSC state").not.toBeNull();
      const firstInterstitial = await waitForImportInterstitial(firstDialog);
      expect(firstInterstitial, "Import source interstitial should be visible before choosing HVSC").not.toBeNull();

      await firstInterstitial.getByTestId("import-option-hvsc").click();
      const preparingSheet = page.getByTestId("hvsc-preparation-sheet");
      await expect(preparingSheet).toBeVisible();
      await expect(page.getByTestId("hvsc-preparation-phase")).toHaveText(/Downloading/i);
      await captureScreenshot(page, testInfo, "play/import/06-hvsc-preparing.png", { skipFuzzyHeadRestore: true });

      await page.getByTestId("hvsc-preparation-cancel").click();
      await expect(preparingSheet).not.toBeVisible();

      await setHvscScreenshotMode(page, "ready");
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForConnected(page);
      await expect(page.getByRole("heading", { name: "Play Files" })).toBeVisible();

      const readyDialog = await openImportDialog(page);
      expect(readyDialog, "Add items dialog should reopen before capturing the ready HVSC state").not.toBeNull();
      const readyInterstitial = await waitForImportInterstitial(readyDialog);
      expect(readyInterstitial, "Import source interstitial should be visible before retrying HVSC").not.toBeNull();

      await readyInterstitial.getByTestId("import-option-hvsc").click();
      await expect(page.getByTestId("hvsc-preparation-sheet")).toBeVisible();
      await expect(page.getByTestId("hvsc-preparation-browse")).toBeVisible();
      await captureScreenshot(page, testInfo, "play/import/07-hvsc-ready.png", { skipFuzzyHeadRestore: true });

      await page.getByTestId("hvsc-preparation-browse").click();
      await expect(readyDialog.getByTestId("source-file-picker")).toBeVisible();
      await expect(readyDialog.getByTestId("add-items-selection-heading")).toContainText("From HVSC");
      await captureScreenshot(page, testInfo, "play/import/08-hvsc-browser.png", { skipFuzzyHeadRestore: true });
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
        await waitForConnected(page);
        await expect(page.getByRole("heading", { name: "Play Files" })).toBeVisible();

        const dialog = await openImportDialog(page);
        expect(dialog, `Add items dialog should open for ${profileId} import screenshots`).not.toBeNull();
        const interstitial = await waitForImportInterstitial(dialog);
        expect(interstitial, `Import source interstitial should be visible for ${profileId}`).not.toBeNull();
        await captureScreenshot(
          page,
          testInfo,
          profileScreenshotPath("play/import", profileId, "01-import-interstitial.png"),
          { skipFuzzyHeadRestore: true },
        );

        await interstitial.getByTestId("import-option-c64u").click();
        await expect(dialog.getByTestId("c64u-file-picker")).toBeVisible();
        await expect(dialog.getByTestId("add-items-selection-heading")).toHaveText("From C64U");
        await captureScreenshot(
          page,
          testInfo,
          profileScreenshotPath("play/import", profileId, "02-c64u-file-picker.png"),
          { skipFuzzyHeadRestore: true },
        );
        await dialog.getByRole("button", { name: "Cancel" }).click();
      }
    },
  );

  test(
    "capture settings screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installSavedDeviceScreenshotState(page, server.baseUrl, true);
      await page.goto("/settings");
      await waitForConnected(page);
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, 0));
      await captureScreenshot(page, testInfo, "settings/01-overview.png");
      await capturePageSections(page, testInfo, "settings");

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId("settings-delete-device").click();
      const deleteDialog = page.getByRole("alertdialog", { name: "Delete device?" });
      await expect(deleteDialog).toBeVisible();
      await captureScreenshot(page, testInfo, "settings/device-switch/01-delete-warning.png", {
        locator: deleteDialog,
        skipFuzzyHeadRestore: true,
      });
      await deleteDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(deleteDialog).toBeHidden();
    },
  );

  test(
    "capture settings profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installSavedDeviceScreenshotState(page, server.baseUrl);
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
    "capture settings header badge screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installSavedDeviceScreenshotState(page, server.baseUrl);
      const headerRow = page.getByTestId("app-bar-row");
      const badge = page.getByTestId("unified-health-badge");
      const scenarios = [
        { fileSuffix: "healthy", health: "Healthy" as const, problemCount: 0, expectedText: null },
        { fileSuffix: "degraded-12", health: "Degraded" as const, problemCount: 12, expectedText: "12" },
        { fileSuffix: "degraded-999plus", health: "Degraded" as const, problemCount: 1808, expectedText: "999+" },
        { fileSuffix: "unhealthy-12", health: "Unhealthy" as const, problemCount: 12, expectedText: "12" },
        {
          fileSuffix: "unhealthy-999plus",
          health: "Unhealthy" as const,
          problemCount: 1808,
          expectedText: "999+",
        },
      ];

      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        for (const scenario of scenarios) {
          await page.goto("/settings");
          await applyDisplayProfileViewport(page, profileId);
          await waitForConnected(page);
          await page.evaluate(() => window.scrollTo(0, 0));
          await seedBadgeHealthTraceState(page, {
            health: scenario.health,
            problemCount: scenario.problemCount,
          });

          await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
          await expect(badge).toBeVisible();
          await expect(badge).toHaveAttribute("data-health-state", scenario.health);

          if (scenario.expectedText) {
            await expect(badge).toContainText(scenario.expectedText);
          }

          await captureScreenshot(page, testInfo, `settings/header/badge-${profileId}-${scenario.fileSuffix}.png`, {
            locator: headerRow,
          });
        }
      }
    },
  );

  test(
    "capture switch-device screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installSavedDeviceScreenshotState(page, server.baseUrl);

      const diagnosticsButton = page.getByTestId("unified-health-badge");
      const openSwitchDeviceSheet = async () => {
        await diagnosticsButton.dispatchEvent("pointerdown");
        await page.waitForTimeout(500);
        const sheet = page.getByTestId("switch-device-sheet");
        await expect(sheet).toBeVisible();
        await diagnosticsButton.dispatchEvent("pointerup");
        return sheet;
      };

      const expandAllDeviceRows = async (sheet: Locator) => {
        for (const deviceId of ["device-c64u-primary", "device-c64u-secondary", "device-c64u-custom"] as const) {
          await sheet.getByTestId(`switch-device-expand-${deviceId}`).click();
        }

        await expect(sheet.locator('[data-testid="health-check-detail-view"]')).toHaveCount(3);
      };

      const closeSwitchDeviceSheet = async (sheet: Locator) => {
        await sheet.getByRole("button", { name: "Close" }).click();
        await expect(sheet).toBeHidden();
      };

      const configureSwitchDeviceViewport = async (profileId: DisplayProfileViewportId) => {
        await page.goto("/");
        await applyDisplayProfileViewport(page, profileId);
        await waitForStableRender(page);
        await waitForConnected(page);
        await expect(diagnosticsButton).toBeVisible();
      };

      const captureSwitchDeviceMatrix = async (
        resolvePath: (fileName: string) => string,
        profileId: DisplayProfileViewportId,
      ) => {
        await configureSwitchDeviceViewport(profileId);
        await seedSwitchDeviceHealthProgress(page);

        let switchDeviceSheet = await openSwitchDeviceSheet();

        await captureFramedScreenshot(page, testInfo, resolvePath("01-picker.png"), "switch-device-sheet", {
          locator: switchDeviceSheet,
        });

        await expandAllDeviceRows(switchDeviceSheet);
        await captureFramedScreenshot(page, testInfo, resolvePath("02-picker-expanded.png"), "switch-device-sheet", {
          locator: switchDeviceSheet,
        });

        await closeSwitchDeviceSheet(switchDeviceSheet);

        await seedSwitchDeviceHealthAllHealthy(page);
        switchDeviceSheet = await openSwitchDeviceSheet();
        await expect(switchDeviceSheet).not.toContainText("U64");
        await expect(switchDeviceSheet.getByTestId("switch-device-status-device-c64u-primary")).toContainText(
          "Healthy",
        );
        await expect(switchDeviceSheet.getByTestId("switch-device-status-device-c64u-secondary")).toContainText(
          "Healthy",
        );
        await expect(switchDeviceSheet.getByTestId("switch-device-status-device-c64u-custom")).toContainText("Healthy");
        await captureFramedScreenshot(page, testInfo, resolvePath("03-picker-all-healthy.png"), "switch-device-sheet", {
          locator: switchDeviceSheet,
        });

        await expandAllDeviceRows(switchDeviceSheet);
        await captureFramedScreenshot(
          page,
          testInfo,
          resolvePath("05-picker-all-healthy-expanded.png"),
          "switch-device-sheet",
          {
            locator: switchDeviceSheet,
          },
        );

        await closeSwitchDeviceSheet(switchDeviceSheet);

        await seedSwitchDeviceHealthMixedUnhealthy(page);
        switchDeviceSheet = await openSwitchDeviceSheet();
        await expect(switchDeviceSheet).not.toContainText("U64");
        await expect(switchDeviceSheet.getByTestId("switch-device-status-device-c64u-primary")).toContainText(
          "Healthy",
        );
        await expect(switchDeviceSheet.getByTestId("switch-device-status-device-c64u-secondary")).toContainText(
          "Healthy",
        );
        await expect(switchDeviceSheet.getByTestId("switch-device-status-device-c64u-custom")).toContainText(
          "Unhealthy",
        );
        await captureFramedScreenshot(
          page,
          testInfo,
          resolvePath("04-picker-one-unhealthy.png"),
          "switch-device-sheet",
          {
            locator: switchDeviceSheet,
          },
        );

        await expandAllDeviceRows(switchDeviceSheet);
        await captureFramedScreenshot(
          page,
          testInfo,
          resolvePath("06-picker-one-unhealthy-expanded.png"),
          "switch-device-sheet",
          {
            locator: switchDeviceSheet,
          },
        );

        await closeSwitchDeviceSheet(switchDeviceSheet);
      };

      for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
        await captureSwitchDeviceMatrix(
          (fileName) => profileScreenshotPath("diagnostics/switch-device", profileId, fileName),
          profileId,
        );
      }
    },
  );

  test(
    "capture diagnostics screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installSavedDeviceScreenshotState(page, server.baseUrl);

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
      const activityTypesSection = () =>
        page.getByTestId("filters-editor-surface").locator("section").filter({ hasText: "Activity types" }).first();
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
      await expect(dialog.getByTestId("health-check-probe-telnet")).toHaveAttribute("data-live-status", "running");
      await expect(dialog.getByTestId("health-check-probe-config")).toHaveAttribute("data-live-status", "pending");
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

      await seedDiagnosticsLogsForDeviceFiltering(page);
      await applyActivityFilter(async () => {
        await setActivityTypes(["Logs"]);
        await page
          .getByTestId("filters-editor-surface")
          .getByRole("button", { name: /^C64U FE$/i })
          .click();
      });
      await expect(dialog.getByTestId("filters-collapsed-bar")).toContainText("C64U FE");
      await expect(dialog.getByText("Custom lab import failed")).toBeVisible();
      await expect(dialog.getByText("Primary C64U log")).toBeHidden();
      await expect(dialog.getByText("Secondary rack drift detected")).toBeHidden();
      await expect(dialog.getByText("Legacy unattributed log")).toBeHidden();
      await captureDiagnosticsScreenshot(page, testInfo, "filters/03-device-name-filter.png");
      await applyActivityFilter(async () => {
        // Reset after capturing the device filter view.
      });

      await dialog.getByTestId("diagnostics-overflow-menu").click();
      await expect(page.getByTestId("diagnostics-share-all")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "tools/01-menu.png");
      await dialog.getByTestId("diagnostics-overflow-menu").click();
      await expect(page.getByTestId("diagnostics-share-all")).toBeHidden();

      await dialog.getByTestId("diagnostics-overflow-menu").click();
      await dialog.getByTestId("open-latency-screen").click();
      await expect(page.getByTestId("latency-analysis-popup")).toBeVisible();
      await captureDiagnosticsScreenshot(page, testInfo, "analysis/01-latency.png");
      await page.getByTestId("analytic-popup-close").click();

      await dialog.getByTestId("diagnostics-overflow-menu").click();
      await dialog.getByTestId("open-timeline-screen").click();
      await expect(page.getByTestId("health-history-popup")).toBeVisible();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="health-history-segment-"]').length > 4,
      );
      await page.evaluate(() => {
        const unhealthySegment = document.querySelector<HTMLElement>(
          '[data-testid^="health-history-segment-"][data-state="Unhealthy"]',
        );
        const degradedSegment = document.querySelector<HTMLElement>(
          '[data-testid^="health-history-segment-"][data-state="Degraded"]',
        );
        const target = unhealthySegment ?? degradedSegment;
        if (!target) {
          throw new Error("No non-healthy history segment available for screenshot capture.");
        }
        target.click();
      });
      await expect(page.getByTestId("health-history-event-list")).toBeVisible();
      const firstHistoryEventRow = page.locator('[data-testid^="health-history-event-row-"] button').first();
      await firstHistoryEventRow.click();
      await expect(firstHistoryEventRow).toHaveAttribute("aria-expanded", "true");
      await captureDiagnosticsScreenshot(page, testInfo, "analysis/02-history.png");
      await page.getByTestId("analytic-popup-close").click();
    },
  );

  test(
    "capture diagnostics profile screenshots",
    { tag: "@screenshots" },
    async ({ page }: { page: Page }, testInfo: TestInfo) => {
      await installSavedDeviceScreenshotState(page, server.baseUrl);
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
    await captureFramedScreenshot(page, testInfo, "docs/external/01-external-resources.png", "docs-external", {
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

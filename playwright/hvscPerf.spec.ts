/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { createMockHvscServer } from "./mockHvscServer";
import { clickSourceSelectionButton } from "./sourceSelection";

type HvscPerfTiming = {
  scope: string;
  durationMs: number;
  metadata?: Record<string, unknown> | null;
};

const perfOutputFile = process.env.HVSC_PERF_OUTPUT_FILE;

declare global {
  interface Window {
    __hvscMock__?: Record<string, unknown>;
  }
}

const seedBaseConfig = async (page: Page, baseUrl: string, hvscBaseUrl: string) => {
  await page.addInitScript(
    ({ baseUrlArg, hvscUrl }: { baseUrlArg: string; hvscUrl: string }) => {
      const host = baseUrlArg?.replace(/^https?:\/\//, "");
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
      localStorage.setItem("c64u_device_host", host || "c64u");
      localStorage.setItem("c64u_hvsc_base_url", hvscUrl);

      const routingWindow = window as Window & {
        __c64uExpectedBaseUrl?: string;
        __c64uAllowedBaseUrls?: string[];
      };
      routingWindow.__c64uExpectedBaseUrl = baseUrlArg;
      routingWindow.__c64uAllowedBaseUrls = [baseUrlArg, hvscUrl].filter(Boolean);
    },
    {
      baseUrlArg: baseUrl,
      hvscUrl: hvscBaseUrl,
    },
  );
};

const installReadyHvscMock = async (
  page: Page,
  fixture: {
    baseline: Awaited<ReturnType<typeof createMockHvscServer>>["baseline"];
    update: Awaited<ReturnType<typeof createMockHvscServer>>["update"];
  },
) => {
  await page.addInitScript(({ baseline, update }) => {
    const songs = [...baseline.songs, ...update.songs];
    const buildIndex = () => {
      const songById: Record<number, any> = {};
      songs.forEach((song, index) => {
        songById[index + 1] = { ...song, id: index + 1 };
      });
      return { songById };
    };

    window.__hvscMock__ = {
      addListener: async () => ({ remove: async () => undefined }),
      getHvscStatus: async () => ({
        installedBaselineVersion: baseline.version,
        installedVersion: update.version,
        ingestionState: "ready",
        lastUpdateCheckUtcMs: Date.now(),
        ingestionError: null,
      }),
      getHvscCacheStatus: async () => ({
        baselineVersion: baseline.version,
        updateVersions: [update.version],
      }),
      checkForHvscUpdates: async () => ({
        latestVersion: update.version,
        installedVersion: update.version,
        baselineVersion: baseline.version,
        requiredUpdates: [],
      }),
      installOrUpdateHvsc: async () => ({
        installedBaselineVersion: baseline.version,
        installedVersion: update.version,
        ingestionState: "ready",
        lastUpdateCheckUtcMs: Date.now(),
        ingestionError: null,
      }),
      ingestCachedHvsc: async () => ({
        installedBaselineVersion: baseline.version,
        installedVersion: update.version,
        ingestionState: "ready",
        lastUpdateCheckUtcMs: Date.now(),
        ingestionError: null,
      }),
      cancelHvscInstall: async () => undefined,
      getHvscFolderListing: async ({ path }: { path: string }) => {
        const normalized = path || "/";
        const folders = Array.from(
          new Set(
            songs
              .map((song) => song.virtualPath.substring(0, song.virtualPath.lastIndexOf("/")) || "/")
              .filter((folder) => folder && folder.toLowerCase() !== normalized.toLowerCase()),
          ),
        ).sort();
        const { songById } = buildIndex();
        return {
          path: normalized,
          folders,
          songs: Object.values(songById).filter((song: any) => {
            const dir = song.virtualPath.substring(0, song.virtualPath.lastIndexOf("/")) || "/";
            return dir.toLowerCase() === normalized.toLowerCase();
          }),
        };
      },
      getHvscSong: async ({ id, virtualPath }: { id?: number; virtualPath?: string }) => {
        const { songById } = buildIndex();
        const song = id
          ? songById[id]
          : Object.values(songById).find((entry: any) => entry.virtualPath === virtualPath);
        if (!song) throw new Error("Song not found");
        return {
          id: song.id,
          virtualPath: song.virtualPath,
          fileName: song.fileName,
          durationSeconds: song.durationSeconds,
          subsongCount: song.durations?.length ?? null,
          durationsSeconds: song.durations ?? null,
          md5: null,
          dataBase64: song.dataBase64,
        };
      },
      getHvscDurationByMd5: async () => ({ durationSeconds: null }),
    };
  }, fixture);
};

const openHvscSourceBrowser = async (page: Page) => {
  await page.getByRole("button", { name: /Add items|Add more items/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(async () => dialog.getByTestId("import-option-hvsc").count()).toBeGreaterThan(0);
  await clickSourceSelectionButton(dialog, "HVSC");
  await expect(dialog.getByTestId("source-entry-row").first()).toBeVisible();
  return dialog;
};

const tryOpenFolderByToken = async (dialog: ReturnType<Page["getByRole"]>, token: string) => {
  const row = dialog
    .getByTestId("source-entry-row")
    .filter({ hasText: new RegExp(token, "i") })
    .first();
  if ((await row.count()) === 0) return false;
  await row.click();
  return true;
};

const getHvscPerfTimings = async (page: Page): Promise<HvscPerfTiming[]> => {
  return await page.evaluate(() => {
    const tracing = (
      window as Window & {
        __c64uTracing?: { getHvscPerfTimings?: () => HvscPerfTiming[] };
      }
    ).__c64uTracing;
    return tracing?.getHvscPerfTimings?.() ?? [];
  });
};

const resetHvscPerfTimings = async (page: Page) => {
  await page.evaluate(() => {
    const tracing = (
      window as Window & {
        __c64uTracing?: { resetHvscPerfTimings?: () => void };
      }
    ).__c64uTracing;
    tracing?.resetHvscPerfTimings?.();
  });
};

const findTiming = (timings: HvscPerfTiming[], scope: string, predicate?: (timing: HvscPerfTiming) => boolean) =>
  timings.find((timing) => timing.scope === scope && (!predicate || predicate(timing)))?.durationMs ?? null;

test.describe("HVSC perf", () => {
  let c64Server: Awaited<ReturnType<typeof createMockC64Server>>;
  let hvscServer: Awaited<ReturnType<typeof createMockHvscServer>>;

  test.beforeAll(async () => {
    c64Server = await createMockC64Server({});
    hvscServer = await createMockHvscServer({
      baselineArchivePath: process.env.HVSC_PERF_BASELINE_ARCHIVE,
      updateArchivePath: process.env.HVSC_PERF_UPDATE_ARCHIVE,
      bytesPerSecond: process.env.HVSC_PERF_BYTES_PER_SECOND
        ? Number(process.env.HVSC_PERF_BYTES_PER_SECOND)
        : undefined,
      logRequests: process.env.HVSC_PERF_LOG_REQUESTS === "1",
    });
  });

  test.afterAll(async () => {
    await hvscServer.close();
    await c64Server.close();
  });

  test("collects secondary web browse and playback timings", async ({ page }) => {
    await seedBaseConfig(page, c64Server.baseUrl, `${hvscServer.baseUrl}/hvsc`);
    await installReadyHvscMock(page, { baseline: hvscServer.baseline, update: hvscServer.update });
    await page.goto("/play");
    await expect(page.getByTestId("hvsc-controls")).toContainText("Installed version");
    await page.waitForFunction(() => Boolean((window as Window & { __c64uTracing?: unknown }).__c64uTracing));

    hvscServer.clearRequestLog();
    await resetHvscPerfTimings(page);

    const dialog = await openHvscSourceBrowser(page);
    if (!(await tryOpenFolderByToken(dialog, "0-9"))) {
      await tryOpenFolderByToken(dialog, "DEMOS");
      await tryOpenFolderByToken(dialog, "0-9");
    }

    const filterInput = dialog.getByTestId("add-items-filter");
    if (await filterInput.count()) {
      await filterInput.fill("Orbyte");
    }

    const specificTrack = dialog.getByLabel("Select 10_Orbyte.sid", { exact: true });
    if (await specificTrack.count()) {
      await specificTrack.click();
    } else {
      await dialog
        .getByLabel(/^Select .+/)
        .first()
        .click();
    }
    await dialog.getByTestId("add-items-confirm").click();
    await expect(dialog).toBeHidden();

    await page
      .getByTestId("playlist-item")
      .filter({ hasText: /10_Orbyte\.sid/i })
      .getByRole("button", { name: "Play" })
      .click();
    await expect.poll(() => c64Server.sidplayRequests.length).toBeGreaterThan(0);

    const timings = await getHvscPerfTimings(page);
    const result = {
      generatedAt: new Date().toISOString(),
      scenario: "web-browse-playback-secondary",
      metrics: {
        browseLoadSnapshotMs: findTiming(timings, "browse:load-snapshot"),
        browseInitialQueryMs: findTiming(
          timings,
          "browse:query",
          (timing) => !String(timing.metadata?.query ?? "").trim(),
        ),
        browseSearchQueryMs: findTiming(
          timings,
          "browse:query",
          (timing) => String(timing.metadata?.query ?? "").trim().length > 0,
        ),
        playbackLoadSidMs: findTiming(timings, "playback:load-sid"),
      },
      hvscPerfTimings: timings,
      requestLog: hvscServer.getRequestLog(),
      sidplayRequestCount: c64Server.sidplayRequests.length,
    };

    if (perfOutputFile) {
      await fs.mkdir(path.dirname(perfOutputFile), { recursive: true });
      await fs.writeFile(perfOutputFile, JSON.stringify(result, null, 2), "utf8");
    }
  });
});

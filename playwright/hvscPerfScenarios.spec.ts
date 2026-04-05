/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * HVSC Performance Benchmark Scenarios S1–S11 (web platform).
 *
 * This spec exercises the full HVSC lifecycle on the web platform:
 *   S1  — Download HVSC from mock server
 *   S2  — Ingest cached HVSC (cold)
 *   S3  — Open add-items dialog → enter HVSC root
 *   S4  — Traverse down: root → nested folder
 *   S5  — Traverse back up to root
 *   S6  — Add all available songs to playlist
 *   S7  — Render the playlist
 *   S8  — Filter playlist: high-match query
 *   S9  — Filter playlist: zero-match query
 *   S10 — Filter playlist: low-match query
 *   S11 — Start playback from playlist
 *
 * Quick CI mode uses small fixtures (3 songs). Nightly mode with
 * real archive env vars uses 60K+ archives if available.
 * Full-scale S6–S10 budgets are only meaningful with real archives.
 *
 * Platform notes:
 * - S1/S2 at full scale (80 MB archive) are only measurable on Android
 *   due to the web MAX_BRIDGE_READ_BYTES guard.
 * - S8-S10 record wall-clock timings; the `playlist:filter` perf scope
 *   is not yet instrumented (tracked for P1.4).
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

type ScenarioResult = {
    scenario: string;
    wallClockMs: number;
    timings: HvscPerfTiming[];
};

const perfOutputFile = process.env.HVSC_PERF_SCENARIOS_OUTPUT_FILE;

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
        { baseUrlArg: baseUrl, hvscUrl: hvscBaseUrl },
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

const tryOpenFolderByToken = async (dialog: ReturnType<Page["getByRole"]>, token: string): Promise<boolean> => {
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

const waitForHvscDownloadComplete = async (page: Page) => {
    const controls = page.getByTestId("hvsc-controls");
    const ingestButton = page.locator("#hvsc-ingest");
    await expect
        .poll(
            async () => {
                const text = (await controls.textContent()) ?? "";
                if (/Installed version|Status: Ready/i.test(text)) return "ready";
                const ingestReady = await ingestButton.isEnabled().catch(() => false);
                if (ingestReady && /Run Ingest HVSC|HVSC archives are cached/i.test(text)) return "cached";
                return "";
            },
            { timeout: 600_000 },
        )
        .not.toBe("");
    return (await controls.textContent()) ?? "";
};

const waitForHvscReady = async (page: Page) => {
    await expect(page.getByTestId("hvsc-controls")).toContainText(/Installed version|Status: Ready/i, {
        timeout: 600_000,
    });
};

const findTiming = (timings: HvscPerfTiming[], scope: string, predicate?: (timing: HvscPerfTiming) => boolean) =>
    timings.find((timing) => timing.scope === scope && (!predicate || predicate(timing)))?.durationMs ?? null;

const measureWallClock = async <T>(fn: () => Promise<T>): Promise<{ result: T; wallClockMs: number }> => {
    const start = performance.now();
    const result = await fn();
    return { result, wallClockMs: performance.now() - start };
};

/** Setup page with mock C64 + HVSC servers and ready HVSC mock. */
const setupReadyHvscPage = async (
    page: Page,
    c64Server: Awaited<ReturnType<typeof createMockC64Server>>,
    hvscServer: Awaited<ReturnType<typeof createMockHvscServer>>,
) => {
    await seedBaseConfig(page, c64Server.baseUrl, `${hvscServer.baseUrl}/hvsc`);
    await installReadyHvscMock(page, { baseline: hvscServer.baseline, update: hvscServer.update });
    await page.goto("/play");
    await expect(page.getByTestId("hvsc-controls")).toContainText("Installed version");
    await page.waitForFunction(() => Boolean((window as Window & { __c64uTracing?: unknown }).__c64uTracing));
};

/** Add all available HVSC songs to the playlist and close the dialog. */
const addAllHvscSongsToPlaylist = async (page: Page) => {
    const dialog = await openHvscSourceBrowser(page);
    const items = dialog.getByLabel(/^Select .+/);
    const count = await items.count();
    for (let i = 0; i < count; i++) {
        await items.nth(i).click();
    }
    await dialog.getByTestId("add-items-confirm").click();
    await expect(dialog).toBeHidden();
    return count;
};

test.describe("HVSC perf scenarios S1-S11", () => {
    let c64Server: Awaited<ReturnType<typeof createMockC64Server>>;
    let hvscServer: Awaited<ReturnType<typeof createMockHvscServer>>;
    const scenarioResults: ScenarioResult[] = [];

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
        if (perfOutputFile) {
            await fs.mkdir(path.dirname(perfOutputFile), { recursive: true });
            await fs.writeFile(
                perfOutputFile,
                JSON.stringify(
                    {
                        generatedAt: new Date().toISOString(),
                        suite: "hvsc-perf-scenarios-s1-s11",
                        scenarios: scenarioResults,
                        requestLog: hvscServer.getRequestLog(),
                    },
                    null,
                    2,
                ),
                "utf8",
            );
        }
        await hvscServer.close();
        await c64Server.close();
    });

    /**
     * S1: Download HVSC from mock server.
     * Does NOT inject __hvscMock__ so the real download path runs.
     * Fixture mode: tiny archive (< 1 KB). Real-archive mode sets env vars.
     */
    test("S1 download HVSC from mock server", async ({ page }) => {
        test.setTimeout(600_000);
        await seedBaseConfig(page, c64Server.baseUrl, `${hvscServer.baseUrl}/hvsc`);
        await page.goto("/play");
        await page.waitForFunction(() => Boolean((window as Window & { __c64uTracing?: unknown }).__c64uTracing));
        await resetHvscPerfTimings(page);
        hvscServer.clearRequestLog();

        // Click "Download HVSC" button (id="hvsc-download")
        const downloadButton = page.locator("#hvsc-download");
        if (await downloadButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            const { wallClockMs } = await measureWallClock(async () => {
                await downloadButton.click();
                await waitForHvscDownloadComplete(page);
            });

            const timings = await getHvscPerfTimings(page);
            scenarioResults.push({
                scenario: "S1-download",
                wallClockMs,
                timings: timings.filter((t) => t.scope === "download" || t.scope === "download:checksum"),
            });
        } else {
            scenarioResults.push({ scenario: "S1-download", wallClockMs: -1, timings: [] });
        }
    });

    /**
     * S2: Ingest cached HVSC (cold).
     * Each Playwright test is isolated, so establish the cached/install state inside
     * this test instead of assuming S1's state carries across test boundaries.
     */
    test("S2 ingest HVSC", async ({ page }) => {
        test.setTimeout(600_000);
        await seedBaseConfig(page, c64Server.baseUrl, `${hvscServer.baseUrl}/hvsc`);
        await page.goto("/play");
        await page.waitForFunction(() => Boolean((window as Window & { __c64uTracing?: unknown }).__c64uTracing));

        let controlsText = (await page.getByTestId("hvsc-controls").textContent()) ?? "";
        if (!controlsText.match(/Installed version|Status: Ready|Run Ingest HVSC|HVSC archives are cached/i)) {
            const downloadButton = page.locator("#hvsc-download");
            await expect(downloadButton).toBeVisible();
            await downloadButton.click();
            controlsText = await waitForHvscDownloadComplete(page);
        }

        if (controlsText.match(/Run Ingest HVSC|HVSC archives are cached/i)) {
            await resetHvscPerfTimings(page);
            const ingestButton = page.locator("#hvsc-ingest");
            await expect(ingestButton).toBeVisible();
            await expect(ingestButton).toBeEnabled({ timeout: 600_000 });
            await ingestButton.click();
            await waitForHvscReady(page);
        }

        const timings = await getHvscPerfTimings(page);
        const ingestTimings = timings.filter((t) => t.scope.startsWith("ingest:"));

        scenarioResults.push({
            scenario: "S2-ingest",
            wallClockMs: ingestTimings.reduce((sum, t) => sum + t.durationMs, 0) || -1,
            timings: ingestTimings,
        });
    });

    /**
     * S3: Open add-items dialog → enter HVSC root.
     * Measures browse:load-snapshot and initial browse:query timings.
     */
    test("S3 open HVSC source browser", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);
        await resetHvscPerfTimings(page);

        const { wallClockMs } = await measureWallClock(async () => {
            await openHvscSourceBrowser(page);
        });

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S3-enter-hvsc-root",
            wallClockMs,
            timings: timings.filter((t) => t.scope === "browse:load-snapshot" || t.scope === "browse:query"),
        });
    });

    /**
     * S4: Traverse down from root into nested folders.
     * Attempts: DEMOS → 0-9, then MUSICIANS → first available subfolder.
     * With fixture data only, folder navigation may be shallow (3 songs).
     */
    test("S4 traverse down into folders", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);

        const dialog = await openHvscSourceBrowser(page);
        await resetHvscPerfTimings(page);

        const stepTimings: Array<{ step: string; wallClockMs: number }> = [];

        // Try navigating into folders that exist in the fixture
        for (const folder of ["DEMOS", "0-9", "MUSICIANS"]) {
            const { wallClockMs } = await measureWallClock(async () => {
                await tryOpenFolderByToken(dialog, folder);
            });
            stepTimings.push({ step: folder, wallClockMs });
        }

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S4-traverse-down",
            wallClockMs: stepTimings.reduce((sum, s) => sum + s.wallClockMs, 0),
            timings: timings.filter((t) => t.scope === "browse:query"),
        });
    });

    /**
     * S5: Traverse back up to root using the back button.
     */
    test("S5 traverse back up to root", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);

        const dialog = await openHvscSourceBrowser(page);

        // Navigate into a folder first
        if (!(await tryOpenFolderByToken(dialog, "0-9"))) {
            await tryOpenFolderByToken(dialog, "DEMOS");
        }

        await resetHvscPerfTimings(page);

        const backButton = dialog.getByRole("button", { name: /back|parent|navigate up/i });
        const stepTimings: Array<{ wallClockMs: number }> = [];

        for (let i = 0; i < 3; i++) {
            if (await backButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                const { wallClockMs } = await measureWallClock(async () => {
                    await backButton.click();
                });
                stepTimings.push({ wallClockMs });
            }
        }

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S5-traverse-up",
            wallClockMs: stepTimings.reduce((sum, s) => sum + s.wallClockMs, 0),
            timings: timings.filter((t) => t.scope === "browse:query"),
        });
    });

    /**
     * S6: Add all available HVSC songs to the playlist.
     * Fixture mode: 3 songs. Real archives: 60K+.
     */
    test("S6 add songs to playlist", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);
        await resetHvscPerfTimings(page);

        const { wallClockMs } = await measureWallClock(async () => {
            await addAllHvscSongsToPlaylist(page);
        });

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S6-add-to-playlist",
            wallClockMs,
            timings,
        });
    });

    /**
     * S7: Render the playlist after adding items.
     * Verifies playlist-item rows appear. Fixture mode: 3 items.
     */
    test("S7 render playlist", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);
        await addAllHvscSongsToPlaylist(page);

        await resetHvscPerfTimings(page);

        const { wallClockMs } = await measureWallClock(async () => {
            await expect(page.getByTestId("playlist-item").first()).toBeVisible({ timeout: 10_000 });
        });

        scenarioResults.push({
            scenario: "S7-render-playlist",
            wallClockMs,
            timings: [],
        });
    });

    /**
     * S8: Filter playlist with high-match query ("Orbyte").
     * Uses the list-filter-input on the playlist's SelectableActionList.
     * Note: playlist:filter perf scope not yet instrumented (P1.4).
     */
    test("S8 filter playlist high-match", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);
        await addAllHvscSongsToPlaylist(page);
        await expect(page.getByTestId("playlist-item").first()).toBeVisible({ timeout: 10_000 });

        await resetHvscPerfTimings(page);

        const filterInput = page.getByTestId("list-filter-input");
        const { wallClockMs } = await measureWallClock(async () => {
            if (await filterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                await filterInput.fill("Orbyte");
                // Allow debounced filter to settle
                await page.waitForTimeout(500);
            }
        });

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S8-filter-high-match",
            wallClockMs,
            timings: timings.filter((t) => t.scope === "playlist:filter"),
        });
    });

    /**
     * S9: Filter playlist with zero-match query ("xyzzy_no_match_123").
     */
    test("S9 filter playlist zero-match", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);
        await addAllHvscSongsToPlaylist(page);
        await expect(page.getByTestId("playlist-item").first()).toBeVisible({ timeout: 10_000 });

        await resetHvscPerfTimings(page);

        const filterInput = page.getByTestId("list-filter-input");
        const { wallClockMs } = await measureWallClock(async () => {
            if (await filterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                await filterInput.fill("xyzzy_no_match_123");
                await page.waitForTimeout(500);
            }
        });

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S9-filter-zero-match",
            wallClockMs,
            timings: timings.filter((t) => t.scope === "playlist:filter"),
        });
    });

    /**
     * S10: Filter playlist with low-match query ("Commando").
     */
    test("S10 filter playlist low-match", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);
        await addAllHvscSongsToPlaylist(page);
        await expect(page.getByTestId("playlist-item").first()).toBeVisible({ timeout: 10_000 });

        await resetHvscPerfTimings(page);

        const filterInput = page.getByTestId("list-filter-input");
        const { wallClockMs } = await measureWallClock(async () => {
            if (await filterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                await filterInput.fill("Commando");
                await page.waitForTimeout(500);
            }
        });

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S10-filter-low-match",
            wallClockMs,
            timings: timings.filter((t) => t.scope === "playlist:filter"),
        });
    });

    /**
     * S11: Start playback from a playlist item.
     * Adds one song, then clicks Play and waits for the SID play request.
     */
    test("S11 start playback from playlist", async ({ page }) => {
        await setupReadyHvscPage(page, c64Server, hvscServer);

        // Add a single song
        const dialog = await openHvscSourceBrowser(page);
        await dialog
            .getByLabel(/^Select .+/)
            .first()
            .click();
        await dialog.getByTestId("add-items-confirm").click();
        await expect(dialog).toBeHidden();

        await resetHvscPerfTimings(page);

        const { wallClockMs } = await measureWallClock(async () => {
            await page.getByTestId("playlist-item").first().getByRole("button", { name: "Play" }).click();
            await expect.poll(() => c64Server.sidplayRequests.length).toBeGreaterThan(0);
        });

        const timings = await getHvscPerfTimings(page);
        scenarioResults.push({
            scenario: "S11-playback-start",
            wallClockMs,
            timings: timings.filter((t) => t.scope === "playback:load-sid" || t.scope === "playback:first-audio"),
        });
    });
});

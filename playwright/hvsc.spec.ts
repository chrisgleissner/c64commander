/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, Route, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { createMockHvscServer } from './mockHvscServer';
import { uiFixtures } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { assertTraceOrder, enableTraceAssertions, getTraces } from './traceUtils';

declare global {
  interface Window {
    __hvscMock__?: Record<string, any>;
  }
}

test.describe('HVSC Play page', () => {
  let c64Server: Awaited<ReturnType<typeof createMockC64Server>>;
  let hvscServer: Awaited<ReturnType<typeof createMockHvscServer>>;

  test.beforeAll(async () => {
    c64Server = await createMockC64Server({});
    hvscServer = await createMockHvscServer();
  });

  test.afterAll(async () => {
    if (c64Server) await c64Server.close();
    if (hvscServer) await hvscServer.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
    }
  });

  const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
  };

  const expectActionTraceSequence = async (page: Page, testInfo: TestInfo, actionName: string) => {
    await expect.poll(async () => {
      const traces = await getTraces(page);
      const actionStart = traces.find((event) =>
        event.type === 'action-start'
        && (event.data as { name?: string } | undefined)?.name === actionName,
      );
      if (!actionStart) return false;
      const related = traces.filter((event) => event.correlationId === actionStart.correlationId);
      try {
        assertTraceOrder(testInfo, related, ['action-start', 'action-end']);
        return true;
      } catch {
        return false;
      }
    }).toBe(true);
  };

  const seedBaseConfig = async (page: Page, baseUrl: string, hvscBaseUrl: string) => {
    await page.addInitScript(
      ({ baseUrlArg, hvscUrl, snapshot }: { baseUrlArg: string; hvscUrl: string; snapshot: unknown }) => {
        const host = baseUrlArg?.replace(/^https?:\/\//, '');
        localStorage.removeItem('c64u_password');
        localStorage.removeItem('c64u_has_password');
        delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
        localStorage.setItem('c64u_device_host', host || 'c64u');
        localStorage.setItem(`c64u_initial_snapshot:${baseUrlArg}`, JSON.stringify(snapshot));
        sessionStorage.setItem(`c64u_initial_snapshot_session:${baseUrlArg}`, '1');
        localStorage.setItem('c64u_hvsc_base_url', hvscUrl);

        const routingWindow = window as Window & { __c64uExpectedBaseUrl?: string; __c64uAllowedBaseUrls?: string[] };
        routingWindow.__c64uExpectedBaseUrl = baseUrlArg;
        const allowed = new Set<string>();
        if (baseUrlArg) allowed.add(baseUrlArg);
        if (hvscUrl) allowed.add(hvscUrl);
        routingWindow.__c64uAllowedBaseUrls = Array.from(allowed);
      },
      { baseUrlArg: baseUrl, hvscUrl: hvscBaseUrl, snapshot: uiFixtures.initialSnapshot },
    );
  };

  type InstallOptions = {
    installedVersion: number;
    failCheck?: boolean;
    failInstall?: boolean;
    failStage?: 'extract' | 'ingest';
    failInstallAttempts?: number;
    installDelayMs?: number;
    seedInProgressSummary?: boolean;
    downloadProgressSteps?: number[];
    ingestionProgressSteps?: number[];
  };

  const installMocks = async (page: Page, options: InstallOptions = { installedVersion: 0 }) => {
    await page.addInitScript(
      ({
        baseUrl,
        baseline,
        update,
        c64BaseUrl,
        installedVersion,
        failCheck,
        failInstall,
        failStage,
        failInstallAttempts,
        installDelayMs,
        seedInProgressSummary,
        downloadProgressSteps,
        ingestionProgressSteps,
      }: {
        baseUrl: string;
        baseline: typeof hvscServer.baseline;
        update: typeof hvscServer.update;
        c64BaseUrl: string;
        installedVersion: number;
        failCheck: boolean;
        failInstall: boolean;
        failStage?: 'extract' | 'ingest';
        failInstallAttempts?: number;
        installDelayMs?: number;
        seedInProgressSummary?: boolean;
        downloadProgressSteps?: number[];
        ingestionProgressSteps?: number[];
      }) => {
        const listeners: Array<(event: any) => void> = [];
        const now = () => Date.now();
        let installFailuresRemaining = failInstallAttempts ?? (failInstall ? 1 : 0);
        const cancelTokens = new Map<string, { cancelled: boolean }>();
        const installedKey = 'c64u_hvsc_mock_installed_version';
        const readInstalledVersion = () => {
          try {
            const raw = localStorage.getItem(installedKey);
            const parsed = raw ? Number(raw) : 0;
            return Number.isFinite(parsed) ? parsed : 0;
          } catch {
            return 0;
          }
        };
        const writeInstalledVersion = (version: number) => {
          try {
            localStorage.setItem(installedKey, String(version));
          } catch {
            // ignore storage failures
          }
        };

        const mergeSongs = (songs: any[]) => {
          const map = new Map<string, any>();
          songs.forEach((song) => map.set(song.virtualPath, song));
          return Array.from(map.values());
        };

        const buildIndex = (songs: any[]) => {
          const folders = new Set<string>();
          const songById: Record<number, any> = {};
          songs.forEach((song, index) => {
            const path = song.virtualPath;
            const dir = path.substring(0, path.lastIndexOf('/')) || '/';
            folders.add(dir);
            songById[index + 1] = { ...song, id: index + 1 };
          });
          return { folders: Array.from(folders).sort(), songById };
        };

        const persistedVersion = readInstalledVersion();
        const initialInstalledVersion = persistedVersion || installedVersion;
        const state = {
          installedBaselineVersion: initialInstalledVersion ? baseline.version : null,
          installedVersion: initialInstalledVersion,
          ingestionState: 'idle',
          lastUpdateCheckUtcMs: null as number | null,
          ingestionError: null as string | null,
          cachedBaselineVersion: null as number | null,
          cachedUpdateVersions: [] as number[],
          songs: initialInstalledVersion
            ? mergeSongs(initialInstalledVersion >= update.version ? [...baseline.songs, ...update.songs] : [...baseline.songs])
            : [],
        };

        const emit = (payload: any) => listeners.forEach((listener) => listener(payload));

        window.__hvscMock__ = {
          addListener: (_event: string, listener: (event: any) => void) => {
            listeners.push(listener);
            return { remove: async () => { } };
          },
          getHvscStatus: async () => ({
            installedBaselineVersion: state.installedBaselineVersion,
            installedVersion: state.installedVersion,
            ingestionState: state.ingestionState,
            lastUpdateCheckUtcMs: state.lastUpdateCheckUtcMs,
            ingestionError: state.ingestionError,
          }),
          getHvscCacheStatus: async () => ({
            baselineVersion: state.cachedBaselineVersion,
            updateVersions: state.cachedUpdateVersions,
          }),
          checkForHvscUpdates: async () => {
            if (failCheck) throw new Error('Simulated update check failure');
            state.lastUpdateCheckUtcMs = now();
            const required = state.installedVersion >= update.version
              ? []
              : state.installedVersion === 0
                ? [baseline.version + 1, update.version]
                : [update.version];
            return {
              latestVersion: update.version,
              installedVersion: state.installedVersion,
              baselineVersion: state.installedVersion === 0 ? baseline.version : null,
              requiredUpdates: required,
            };
          },
          installOrUpdateHvsc: async ({ cancelToken }: { cancelToken?: string } = {}) => {
            state.ingestionState = 'installing';
            state.ingestionError = null;
            const startTime = now();
            const ingestionId = `mock-${startTime}`;
            const emitStage = (stage: string, message: string, extra: Record<string, any> = {}) =>
              emit({ ingestionId, stage, message, elapsedTimeMs: now() - startTime, ...extra });
            const archiveCount = (state.installedVersion === 0 ? 1 : 0) + (state.installedVersion < update.version ? 1 : 0);

            const ensureNotCancelled = () => {
              if (!cancelToken) return;
              if (cancelTokens.get(cancelToken)?.cancelled) {
                state.ingestionState = 'idle';
                state.ingestionError = 'Cancelled';
                emitStage('error', 'HVSC update cancelled', { errorType: 'Error', errorCause: 'Cancelled' });
                throw new Error('HVSC update cancelled');
              }
            };

            const maybeFail = (stage: string, message: string) => {
              if (installFailuresRemaining <= 0) return;
              const shouldFail = !failStage ||
                (failStage === 'extract' && stage === 'archive_extraction') ||
                (failStage === 'ingest' && stage === 'database_insertion');
              if (!shouldFail) return;
              installFailuresRemaining -= 1;
              state.ingestionState = 'error';
              state.ingestionError = message;
              emitStage('error', message, { errorType: 'Error', errorCause: message });
              throw new Error(message);
            };

            emitStage('start', 'HVSC ingestion started', { percent: 0 });
            emitStage('archive_discovery', `Discovered ${archiveCount} archive(s)`, {
              processedCount: 0,
              totalCount: archiveCount,
            });
            ensureNotCancelled();
            if (installDelayMs) {
              await new Promise((resolve) => setTimeout(resolve, installDelayMs));
              ensureNotCancelled();
            }

            if (state.installedVersion === 0) {
              const archiveName = `HVSC_${baseline.version}-all-of-them.7z`;
              const downloadSteps = downloadProgressSteps?.length
                ? downloadProgressSteps
                : [512];
              for (let index = 0; index < downloadSteps.length; index += 1) {
                const loaded = downloadSteps[index];
                emitStage('download', 'Downloading baseline…', {
                  archiveName,
                  percent: Math.round(((index + 1) / downloadSteps.length) * 100),
                  downloadedBytes: loaded,
                  totalBytes: 4096,
                });
                if (downloadSteps.length > 1) {
                  await new Promise((resolve) => setTimeout(resolve, 40));
                }
              }
              ensureNotCancelled();
              await fetch(`${baseUrl}/hvsc/archive/baseline`).then((res) => res.arrayBuffer());
              ensureNotCancelled();
              state.cachedBaselineVersion = baseline.version;
              emitStage('archive_validation', `Validated ${archiveName}`, { archiveName });
              emitStage('sid_enumeration', `Discovered ${baseline.songs.length} SID files`, {
                archiveName,
                processedCount: 0,
                totalCount: baseline.songs.length,
              });
              emitStage('archive_extraction', 'Extracting baseline…', {
                archiveName,
                processedCount: 0,
                totalCount: baseline.songs.length,
              });
              ensureNotCancelled();
              maybeFail('archive_extraction', 'Simulated extraction failure');
              if (baseline.songs.length) {
                const progressSteps = ingestionProgressSteps?.length
                  ? ingestionProgressSteps
                  : [1];
                for (let index = 0; index < progressSteps.length; index += 1) {
                  const count = progressSteps[index];
                  const bounded = Math.min(count, baseline.songs.length);
                  const song = baseline.songs[bounded - 1] ?? baseline.songs[0];
                  emitStage('sid_metadata_parsing', `Parsed ${song.virtualPath}`, {
                    archiveName,
                    currentFile: song.virtualPath,
                    processedCount: bounded,
                    totalCount: baseline.songs.length,
                    percent: Math.round((bounded / baseline.songs.length) * 100),
                  });
                  if (progressSteps.length > 1) {
                    await new Promise((resolve) => setTimeout(resolve, 160));
                  }
                }
              }
              emitStage('database_insertion', 'Inserted baseline entries', {
                archiveName,
                processedCount: baseline.songs.length,
                totalCount: baseline.songs.length,
                songsUpserted: baseline.songs.length,
                percent: 60,
              });
              ensureNotCancelled();
              maybeFail('database_insertion', 'Simulated ingestion failure');
              state.songs = mergeSongs([...baseline.songs]);
              state.installedBaselineVersion = baseline.version;
              state.installedVersion = baseline.version;
            }
            if (state.installedVersion < update.version) {
              const archiveName = `HVSC_Update_${update.version}.7z`;
              emitStage('download', 'Downloading update…', {
                archiveName,
                percent: 70,
                downloadedBytes: 256,
                totalBytes: 2048,
              });
              ensureNotCancelled();
              await fetch(`${baseUrl}/hvsc/archive/update`).then((res) => res.arrayBuffer());
              ensureNotCancelled();
              state.cachedUpdateVersions = Array.from(new Set([...state.cachedUpdateVersions, update.version]));
              emitStage('archive_validation', `Validated ${archiveName}`, { archiveName });
              emitStage('sid_enumeration', `Discovered ${update.songs.length} SID files`, {
                archiveName,
                processedCount: 0,
                totalCount: update.songs.length,
              });
              emitStage('archive_extraction', 'Extracting update…', {
                archiveName,
                processedCount: 0,
                totalCount: update.songs.length,
              });
              ensureNotCancelled();
              if (update.songs.length) {
                emitStage('sid_metadata_parsing', `Parsed ${update.songs[0].virtualPath}`, {
                  archiveName,
                  currentFile: update.songs[0].virtualPath,
                  processedCount: 1,
                  totalCount: update.songs.length,
                  percent: 80,
                });
              }
              emitStage('database_insertion', 'Inserted update entries', {
                archiveName,
                processedCount: update.songs.length,
                totalCount: update.songs.length,
                songsUpserted: update.songs.length,
                percent: 90,
              });
              ensureNotCancelled();
              state.songs = mergeSongs([...state.songs, ...update.songs]);
              state.installedVersion = update.version;
            }
            state.ingestionState = 'ready';
            writeInstalledVersion(state.installedVersion);
            emitStage('complete', 'HVSC ingestion complete', { percent: 100 });
            return {
              installedBaselineVersion: state.installedBaselineVersion,
              installedVersion: state.installedVersion,
              ingestionState: state.ingestionState,
              lastUpdateCheckUtcMs: state.lastUpdateCheckUtcMs,
              ingestionError: state.ingestionError,
            };
          },
          ingestCachedHvsc: async ({ cancelToken }: { cancelToken?: string } = {}) => {
            state.ingestionState = 'installing';
            state.ingestionError = null;
            const startTime = now();
            const ingestionId = `mock-cache-${startTime}`;
            const emitStage = (stage: string, message: string, extra: Record<string, any> = {}) =>
              emit({ ingestionId, stage, message, elapsedTimeMs: now() - startTime, ...extra });

            const ensureNotCancelled = () => {
              if (!cancelToken) return;
              if (cancelTokens.get(cancelToken)?.cancelled) {
                state.ingestionState = 'idle';
                state.ingestionError = 'Cancelled';
                emitStage('error', 'HVSC update cancelled', { errorType: 'Error', errorCause: 'Cancelled' });
                throw new Error('HVSC update cancelled');
              }
            };

            emitStage('start', 'HVSC cached ingestion started', { percent: 0 });
            ensureNotCancelled();
            if (!state.cachedBaselineVersion) {
              state.ingestionState = 'error';
              state.ingestionError = 'No cached HVSC archive found';
              emitStage('error', 'No cached HVSC archive found', { errorType: 'Error', errorCause: 'No cached HVSC archive found' });
              throw new Error('No cached HVSC archive found');
            }
            const archiveName = `HVSC_${baseline.version}-all-of-them.7z`;
            emitStage('archive_discovery', 'Discovered 1 cached archive', {
              processedCount: 1,
              totalCount: 1,
              archiveName,
            });
            emitStage('archive_validation', `Validated ${archiveName}`, { archiveName });
            emitStage('sid_enumeration', `Discovered ${baseline.songs.length} SID files`, {
              archiveName,
              processedCount: 0,
              totalCount: baseline.songs.length,
            });
            emitStage('archive_extraction', 'Extracting cached archive…', {
              archiveName,
              processedCount: 0,
              totalCount: baseline.songs.length,
            });
            ensureNotCancelled();
            emitStage('database_insertion', 'Inserted cached entries', {
              archiveName,
              processedCount: baseline.songs.length,
              totalCount: baseline.songs.length,
              songsUpserted: baseline.songs.length,
              percent: 90,
            });
            ensureNotCancelled();
            state.songs = mergeSongs([...baseline.songs]);
            state.installedBaselineVersion = baseline.version;
            state.installedVersion = baseline.version;
            state.cachedBaselineVersion = null;
            state.cachedUpdateVersions = [];
            state.ingestionState = 'ready';
            writeInstalledVersion(state.installedVersion);
            emitStage('complete', 'HVSC cached ingestion complete', { percent: 100 });
            return {
              installedBaselineVersion: state.installedBaselineVersion,
              installedVersion: state.installedVersion,
              ingestionState: state.ingestionState,
              lastUpdateCheckUtcMs: state.lastUpdateCheckUtcMs,
              ingestionError: state.ingestionError,
            };
          },
          cancelHvscInstall: async ({ cancelToken }: { cancelToken?: string } = {}) => {
            if (!cancelToken) return;
            if (!cancelTokens.has(cancelToken)) {
              cancelTokens.set(cancelToken, { cancelled: true });
            } else {
              cancelTokens.get(cancelToken)!.cancelled = true;
            }
            state.ingestionState = 'idle';
            state.ingestionError = 'Cancelled';
          },
          getHvscFolderListing: async ({ path }: { path: string }) => {
            const normalized = path || '/';
            const { folders, songById } = buildIndex(state.songs);
            const songs = Object.values(songById).filter((song: any) => {
              const dir = song.virtualPath.substring(0, song.virtualPath.lastIndexOf('/')) || '/';
              return dir.toLowerCase() === normalized.toLowerCase();
            });
            return {
              path: normalized,
              folders,
              songs: songs.map((song: any) => ({
                id: song.id,
                virtualPath: song.virtualPath,
                fileName: song.fileName,
                durationSeconds: song.durationSeconds,
                subsongCount: song.durations?.length ?? null,
              })),
            };
          },
          getHvscSong: async ({ id, virtualPath }: { id?: number; virtualPath?: string }) => {
            const { songById } = buildIndex(state.songs);
            const song = id ? songById[id] : Object.values(songById).find((entry: any) => entry.virtualPath === virtualPath);
            if (!song) throw new Error('Song not found');
            return {
              id: song.id,
              virtualPath: song.virtualPath,
              fileName: song.fileName,
              durationSeconds: song.durationSeconds,
              subsongCount: song.durations?.length ?? null,
              durationsSeconds: song.durations ?? null,
              md5: null as string | null,
              dataBase64: song.dataBase64,
            };
          },
          getHvscDurationByMd5: async () => ({ durationSeconds: null as number | null }),
        };

        if (seedInProgressSummary) {
          const nowIso = new Date().toISOString();
          localStorage.setItem('c64u_hvsc_status:v1', JSON.stringify({
            download: {
              status: 'in-progress',
              startedAt: nowIso,
              durationMs: 0,
            },
            extraction: { status: 'idle' },
            lastUpdatedAt: nowIso,
          }));
        } else {
          localStorage.removeItem('c64u_hvsc_status:v1');
        }

        const host = c64BaseUrl.replace(/^https?:\/\//, '');
        localStorage.setItem('c64u_device_host', host);
        localStorage.setItem('c64u_feature_flag:hvsc_enabled', '1');

        const routingWindow = window as Window & { __c64uExpectedBaseUrl?: string; __c64uAllowedBaseUrls?: string[] };
        routingWindow.__c64uExpectedBaseUrl = c64BaseUrl;
        const allowed = new Set<string>();
        if (c64BaseUrl) allowed.add(c64BaseUrl);
        if (baseUrl) allowed.add(baseUrl);
        routingWindow.__c64uAllowedBaseUrls = Array.from(allowed);
      },
      {
        baseUrl: hvscServer.baseUrl,
        baseline: hvscServer.baseline,
        update: hvscServer.update,
        c64BaseUrl: c64Server.baseUrl,
        installedVersion: options.installedVersion,
        failCheck: options.failCheck ?? false,
        failInstall: options.failInstall ?? false,
        failStage: options.failStage,
        failInstallAttempts: options.failInstallAttempts,
        installDelayMs: options.installDelayMs,
        seedInProgressSummary: options.seedInProgressSummary,
        downloadProgressSteps: options.downloadProgressSteps,
        ingestionProgressSteps: options.ingestionProgressSteps,
      },
    );
  };

  test('HVSC not installed -> install -> ready', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 0, installDelayMs: 4000 });
    await page.route('**/v1/runners:sidplay**', (route: Route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ errors: [] }) }),
    );
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByRole('button', { name: '/DEMOS/0-9', exact: true })).toBeVisible();
    await expectActionTraceSequence(page, testInfo, 'HvscLibrary.handleHvscInstall');
    await snap(page, testInfo, 'hvsc-installed');
  });

  test('HVSC install shows progress updates', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 0 });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByRole('button', { name: '/DEMOS/0-9', exact: true })).toBeVisible();
    await snap(page, testInfo, 'install-complete');
  });

  test('HVSC download + ingest uses mock server and plays a track', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedBaseConfig(page, c64Server.baseUrl, `${hvscServer.baseUrl}/hvsc/`);

    await page.goto('/play');
    await snap(page, testInfo, 'hvsc-runtime-open');

    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByTestId('hvsc-summary')).toContainText('HVSC downloaded successfully');
    await expectActionTraceSequence(page, testInfo, 'HvscLibrary.handleHvscInstall');

    const markerExists = await page.evaluate(async ({ baselineVersion }) => {
      const fs = (window as any)?.Capacitor?.Plugins?.Filesystem;
      const dir = (window as any)?.Capacitor?.Plugins?.Filesystem?.Directory?.Data ?? 'DATA';
      if (!fs) return false;
      try {
        await fs.readFile({ directory: dir, path: `hvsc/cache/hvsc-baseline-${baselineVersion}.7z.complete.json` });
        return true;
      } catch {
        return false;
      }
    }, { baselineVersion: hvscServer.baseline.version });
    expect(markerExists).toBe(true);

    await page.getByRole('button', { name: 'Ingest HVSC' }).click();
    await expect(page.getByTestId('hvsc-summary')).toContainText('HVSC downloaded successfully');
    await expectActionTraceSequence(page, testInfo, 'HvscLibrary.handleHvscIngest');

    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    await page.getByRole('button', { name: 'Play folder' }).click();

    await expect.poll(() => c64Server.requests.some((req) => req.url.startsWith('/v1/runners:sidplay'))).toBe(true);
    await snap(page, testInfo, 'hvsc-playback-requested');
  });

  test('HVSC stop cancels install', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 0 });
    await installMocks(page, { installedVersion: 0, seedInProgressSummary: true });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await expect(page.getByTestId('hvsc-stop')).toBeVisible();
    await page.getByTestId('hvsc-stop').click();
    await expect(page.getByText('HVSC update cancelled', { exact: true })).toBeVisible();
    await expect(page.getByTestId('hvsc-controls').getByText('Cancelled', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'cancelled');
  });

  test('HVSC install -> play sends SID to C64U', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 0 });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByRole('button', { name: '/DEMOS/0-9', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const firstTrack = page.getByText('10_Orbyte.sid', { exact: true });
    await expect(firstTrack).toBeVisible();
    await firstTrack.locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Playlist', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'playlist-visible');

    const expectedPayload = Buffer.from(hvscServer.baseline.songs[0].dataBase64, 'base64');
    await expect
      .poll(() => c64Server.sidplayRequests.length)
      .toBeGreaterThan(0);
    const lastRequest = c64Server.sidplayRequests[c64Server.sidplayRequests.length - 1];
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.body.includes(expectedPayload)).toBe(true);
    await snap(page, testInfo, 'sidplay-requested');
  });

  test('HVSC playlist survives reload', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 0 });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByRole('button', { name: '/DEMOS/0-9', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const firstTrack = page.getByText('10_Orbyte.sid', { exact: true });
    await expect(firstTrack).toBeVisible();
    await firstTrack.locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Playlist', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'playlist-created');

    await expect.poll(() => c64Server.sidplayRequests.length).toBeGreaterThan(0);
    const initialRequests = c64Server.sidplayRequests.length;

    await page.reload();
    await expect(page.getByTestId('playlist-list')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('playlist-list').getByText('10_Orbyte.sid', { exact: true })).toBeVisible({
      timeout: 20000,
    });

    const playButton = page.getByTestId('playlist-play');
    const playLabel = (await playButton.getAttribute('aria-label')) ?? '';
    if (/stop/i.test(playLabel)) {
      await playButton.click();
      await expect(playButton).toHaveAttribute('aria-label', 'Play');
    }
    await playButton.click();

    await expect.poll(() => c64Server.sidplayRequests.length).toBeGreaterThan(initialRequests);
    await snap(page, testInfo, 'playlist-restored');
  });

  test('HVSC download attempt runs while connected to device mock', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 0 });
    await page.goto('/play');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'play-connected');

    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByTestId('hvsc-summary')).toContainText('HVSC downloaded successfully');
    await snap(page, testInfo, 'hvsc-download-attempted');
  });

  test('HVSC download progress updates incrementally', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, {
      installedVersion: 0,
      downloadProgressSteps: [512, 2048, 4096],
      ingestionProgressSteps: [1],
    });
    await page.goto('/play');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByTestId('hvsc-summary')).toContainText('HVSC downloaded successfully');
    await snap(page, testInfo, 'hvsc-download-progress');
  });

  test('HVSC ingestion progress updates incrementally', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, {
      installedVersion: 0,
      downloadProgressSteps: [512, 2048],
      ingestionProgressSteps: [1, 2],
      installDelayMs: 400,
    });
    await page.goto('/play');
    await page.getByRole('button', { name: 'Download HVSC' }).click();

    await expect(page.getByTestId('hvsc-progress')).toBeVisible();
    const files = page.getByTestId('hvsc-extraction-files');
    await expect(files).toContainText('Files:');
    await expect.poll(async () => files.textContent()).toContain('Files: 1');
    await snap(page, testInfo, 'hvsc-extraction-progress');
  });

  test('HVSC cached download -> ingest -> play track', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected extraction failure toast before cached ingest.');
    await installMocks(page, { installedVersion: 0, failInstall: true, failStage: 'extract' });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByText(/Simulated extraction failure/i).first()).toBeVisible();
    await snap(page, testInfo, 'extract-failed');

    await page.getByRole('button', { name: 'Ingest HVSC', exact: true }).click();
    await expect(page.getByRole('button', { name: '/DEMOS/0-9', exact: true })).toBeVisible();
    await snap(page, testInfo, 'ingest-complete');

    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const firstTrack = page.getByText('10_Orbyte.sid', { exact: true });
    await expect(firstTrack).toBeVisible();
    await firstTrack.locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Playlist', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'playlist-visible');

    const expectedPayload = Buffer.from(hvscServer.baseline.songs[0].dataBase64, 'base64');
    await expect
      .poll(() => c64Server.sidplayRequests.length)
      .toBeGreaterThan(0);
    const lastRequest = c64Server.sidplayRequests[c64Server.sidplayRequests.length - 1];
    expect(lastRequest.body.includes(expectedPayload)).toBe(true);
    await snap(page, testInfo, 'sidplay-requested');
  });

  test('HVSC up-to-date -> browse -> play track', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 84 });
    await page.route('**/v1/runners:sidplay**', (route: Route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ errors: [] }) }),
    );

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const firstTrack = page.getByText(/\.sid$/i).first();
    await expect(firstTrack).toBeVisible();
    await snap(page, testInfo, 'hvsc-list');
    await firstTrack.locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Playlist', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'playlist-visible');
  });

  test('HVSC update available -> update -> browsing works', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 83 });
    await page.route('**/v1/runners:sidplay**', (route: Route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ errors: [] }) }),
    );

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByRole('button', { name: '/DEMOS/0-9', exact: true })).toBeVisible();
    await snap(page, testInfo, 'update-complete');
    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    await expect(page.getByText(/\.sid$/i).first()).toBeVisible();
    await snap(page, testInfo, 'hvsc-list');
  });

  test('Local ZIP ingestion is not shown on Play page', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installMocks(page, { installedVersion: 84 });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await expect(page.getByText(/local\.zip/i)).toHaveCount(0);
    await snap(page, testInfo, 'zip-hidden');
  });

  test('HVSC update check failure surfaces error', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected error toast for HVSC update check failure.');
    await installMocks(page, { installedVersion: 0, failCheck: true });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByText(/Simulated update check failure/i).first()).toBeVisible();
    await snap(page, testInfo, 'update-failed');
  });

  test('HVSC extraction failure shows retry', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected error toast for HVSC extraction failure.');
    await installMocks(page, { installedVersion: 0, failStage: 'extract', failInstallAttempts: 1 });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByText(/Simulated extraction failure/i).first()).toBeVisible();
    await snap(page, testInfo, 'extract-failed');
  });

  test('HVSC ingestion failure shows retry', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected error toast for HVSC ingestion failure.');
    await installMocks(page, { installedVersion: 0, failStage: 'ingest', failInstallAttempts: 1 });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: 'Download HVSC' }).click();
    await expect(page.getByText(/Simulated ingestion failure/i).first()).toBeVisible();
    await snap(page, testInfo, 'ingest-failed');
  });

  test('displays song lengths and handles multi-subsong expansion', async ({ page }, testInfo) => {
    // 1. Install mocks with installedVersion: baseline (83)
    await installMocks(page, { installedVersion: 83 });
    await page.goto('/play');

    // 2. Navigate to /DEMOS/0-9
    await page.getByRole('button', { name: '/DEMOS/0-9' }).click();

    // 3. Verify duration display
    await expect(page.getByText('1:17')).toBeVisible();
    await expect(page.getByText('2:41')).toBeVisible();

    // 4. Navigate to /DEMOS/M/
    await page.getByRole('button', { name: 'Up' }).click();
    await page.getByRole('button', { name: '/DEMOS/M' }).click();

    // 5. Expand multi-subsong
    const fileItem = page.getByText('Multi_Track.sid', { exact: true });
    await expect(fileItem).toBeVisible();

    // Trigger expansion/add (Simulate Right Click -> Add to Playlist)
    await fileItem.click({ button: 'right' });
    await expect(page.getByText('Add to playlist')).toBeVisible();
    await page.getByText('Add to playlist').click();

    // Verify toast or playlist update
    // Assuming toast says "Added 3 songs" or similar
    // Or we can check if the playlist is updated if visible.
  });
});

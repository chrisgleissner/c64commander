import { test, expect, type Page, type Route, type ConsoleMessage } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { createMockHvscServer } from './mockHvscServer';

declare global {
  interface Window {
    __hvscMock__?: Record<string, any>;
  }
}

test.describe('HVSC Play page', () => {
  let c64Server: Awaited<ReturnType<typeof createMockC64Server>>;
  let hvscServer: Awaited<ReturnType<typeof createMockHvscServer>>;
  const consoleErrors = new WeakMap<Page, string[]>();

  test.beforeAll(async () => {
    c64Server = await createMockC64Server({});
    hvscServer = await createMockHvscServer();
  });

  test.afterAll(async () => {
    if (c64Server) await c64Server.close();
    if (hvscServer) await hvscServer.close();
  });

  test.beforeEach(async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err: Error) => errors.push(err.message));
    consoleErrors.set(page, errors);
  });

  test.afterEach(async ({ page }: { page: Page }) => {
    const errors = consoleErrors.get(page) ?? [];
    expect(errors, `Console errors: ${errors.join('\n')}`).toEqual([]);
  });

  type InstallOptions = {
    installedVersion: number;
    failCheck?: boolean;
    failInstall?: boolean;
    failStage?: 'extract' | 'ingest';
    failInstallAttempts?: number;
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
      }) => {
        const listeners: Array<(event: any) => void> = [];
        const now = () => Date.now();
        let installFailuresRemaining = failInstallAttempts ?? (failInstall ? 1 : 0);

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

        const state = {
          installedBaselineVersion: installedVersion ? baseline.version : null,
          installedVersion,
          ingestionState: 'idle',
          lastUpdateCheckUtcMs: null as number | null,
          ingestionError: null as string | null,
          cachedBaselineVersion: null as number | null,
          cachedUpdateVersions: [] as number[],
          songs: installedVersion ? mergeSongs([...baseline.songs, ...update.songs]) : [],
        };

        const emit = (payload: any) => listeners.forEach((listener) => listener(payload));

        window.__hvscMock__ = {
          addListener: (_event: string, listener: (event: any) => void) => {
            listeners.push(listener);
            return { remove: async () => {} };
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
          installOrUpdateHvsc: async () => {
            state.ingestionState = 'installing';
            state.ingestionError = null;
            const startTime = now();
            const ingestionId = `mock-${startTime}`;
            const emitStage = (stage: string, message: string, extra: Record<string, any> = {}) =>
              emit({ ingestionId, stage, message, elapsedTimeMs: now() - startTime, ...extra });
            const archiveCount = (state.installedVersion === 0 ? 1 : 0) + (state.installedVersion < update.version ? 1 : 0);

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

            if (state.installedVersion === 0) {
              const archiveName = `HVSC_${baseline.version}-all-of-them.7z`;
              emitStage('download', 'Downloading baseline…', {
                archiveName,
                percent: 10,
                downloadedBytes: 512,
                totalBytes: 4096,
              });
              await fetch(`${baseUrl}/hvsc/archive/baseline`).then((res) => res.arrayBuffer());
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
              maybeFail('archive_extraction', 'Simulated extraction failure');
              if (baseline.songs.length) {
                emitStage('sid_metadata_parsing', `Parsed ${baseline.songs[0].virtualPath}`, {
                  archiveName,
                  currentFile: baseline.songs[0].virtualPath,
                  processedCount: 1,
                  totalCount: baseline.songs.length,
                  percent: 20,
                });
              }
              emitStage('database_insertion', 'Inserted baseline entries', {
                archiveName,
                processedCount: baseline.songs.length,
                totalCount: baseline.songs.length,
                songsUpserted: baseline.songs.length,
                percent: 60,
              });
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
              await fetch(`${baseUrl}/hvsc/archive/update`).then((res) => res.arrayBuffer());
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
              state.songs = mergeSongs([...state.songs, ...update.songs]);
              state.installedVersion = update.version;
            }
            state.ingestionState = 'ready';
            emitStage('complete', 'HVSC ingestion complete', { percent: 100 });
            return {
              installedBaselineVersion: state.installedBaselineVersion,
              installedVersion: state.installedVersion,
              ingestionState: state.ingestionState,
              lastUpdateCheckUtcMs: state.lastUpdateCheckUtcMs,
              ingestionError: state.ingestionError,
            };
          },
          ingestCachedHvsc: async () => {
            state.ingestionState = 'installing';
            state.ingestionError = null;
            const startTime = now();
            const ingestionId = `mock-cache-${startTime}`;
            const emitStage = (stage: string, message: string, extra: Record<string, any> = {}) =>
              emit({ ingestionId, stage, message, elapsedTimeMs: now() - startTime, ...extra });

            emitStage('start', 'HVSC cached ingestion started', { percent: 0 });
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
            emitStage('database_insertion', 'Inserted cached entries', {
              archiveName,
              processedCount: baseline.songs.length,
              totalCount: baseline.songs.length,
              songsUpserted: baseline.songs.length,
              percent: 90,
            });
            state.songs = mergeSongs([...baseline.songs]);
            state.installedBaselineVersion = baseline.version;
            state.installedVersion = baseline.version;
            state.cachedBaselineVersion = null;
            state.cachedUpdateVersions = [];
            state.ingestionState = 'ready';
            emitStage('complete', 'HVSC cached ingestion complete', { percent: 100 });
            return {
              installedBaselineVersion: state.installedBaselineVersion,
              installedVersion: state.installedVersion,
              ingestionState: state.ingestionState,
              lastUpdateCheckUtcMs: state.lastUpdateCheckUtcMs,
              ingestionError: state.ingestionError,
            };
          },
          cancelHvscInstall: async () => {},
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
              md5: null as string | null,
              dataBase64: song.dataBase64,
            };
          },
          getHvscDurationByMd5: async () => ({ durationSeconds: null as number | null }),
        };

        localStorage.setItem('c64u_base_url', c64BaseUrl);
        localStorage.setItem('c64u_feature_flag:sid_player_enabled', '1');
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
      },
    );
  };

  test('HVSC not installed -> install -> ready', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0 });
    await page.route('**/v1/runners:sidplay**', (route: Route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ errors: [] }) }),
    );
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText(/Version 84 installed/i).first()).toBeVisible();
  });

  test('HVSC install shows progress updates', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0 });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText(/SID files:/i).first()).toBeVisible();
    await expect(page.getByText(/%/).first()).toBeVisible();
    await expect(page.getByText(/Version 84 installed/i).first()).toBeVisible();
  });

  test('HVSC install -> play sends SID to C64U', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0 });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText(/Version 84 installed/i).first()).toBeVisible();

    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const firstTrack = page.getByText('/DEMOS/0-9/10_Orbyte.sid', { exact: true });
    await expect(firstTrack).toBeVisible();
    await firstTrack.locator('..').getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Now Playing')).toBeVisible();

    const expectedPayload = Buffer.from(hvscServer.baseline.songs[0].dataBase64, 'base64');
    await expect
      .poll(() => c64Server.sidplayRequests.length)
      .toBeGreaterThan(0);
    const lastRequest = c64Server.sidplayRequests[c64Server.sidplayRequests.length - 1];
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.body.includes(expectedPayload)).toBe(true);
  });

  test('HVSC cached download -> ingest -> play track', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0, failInstall: true, failStage: 'extract' });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText(/Simulated extraction failure/i).first()).toBeVisible();

    await page.getByRole('button', { name: 'Ingest', exact: true }).click();
    await expect(page.getByText(/Version 83 installed/i).first()).toBeVisible();

    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const firstTrack = page.getByText('/DEMOS/0-9/10_Orbyte.sid', { exact: true });
    await expect(firstTrack).toBeVisible();
    await firstTrack.locator('..').getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Now Playing')).toBeVisible();

    const expectedPayload = Buffer.from(hvscServer.baseline.songs[0].dataBase64, 'base64');
    await expect
      .poll(() => c64Server.sidplayRequests.length)
      .toBeGreaterThan(0);
    const lastRequest = c64Server.sidplayRequests[c64Server.sidplayRequests.length - 1];
    expect(lastRequest.body.includes(expectedPayload)).toBe(true);
  });

  test('HVSC up-to-date -> browse -> play track', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 84 });
    await page.route('**/v1/runners:sidplay**', (route: Route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ errors: [] }) }),
    );

    await page.goto('/music');
    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const firstTrack = page.getByText(/\.sid$/i).first();
    await expect(firstTrack).toBeVisible();
    await firstTrack.locator('..').getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Now Playing')).toBeVisible();
  });

  test('HVSC update available -> update -> browsing works', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 83 });
    await page.route('**/v1/runners:sidplay**', (route: Route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ errors: [] }) }),
    );

    await page.goto('/music');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText(/Version 84 installed/i).first()).toBeVisible();
    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    await expect(page.getByText(/\.sid$/i).first()).toBeVisible();
  });

  test('Local ZIP folder ingestion lists SID files', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 84 });
    await page.goto('/music');
    await page.getByRole('tab', { name: 'Local Library' }).click();

    const zipData = zipSync({
      'C64Music/track.sid': strToU8('SIDDATA'),
      'C64Music/readme.txt': strToU8('ignore'),
    });
    await page.setInputFiles('input[type="file"]', {
      name: 'local.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(zipData),
    });

    await expect(page.getByText('1 SID files selected')).toBeVisible();
    await page.getByRole('button', { name: /local\.zip/i }).click();
    await expect(page.getByText(/track\.sid$/i)).toBeVisible();
  });

  test('HVSC update check failure surfaces error', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0, failCheck: true });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText(/Simulated update check failure/i).first()).toBeVisible();
  });

  test('HVSC extraction failure shows retry', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0, failStage: 'extract', failInstallAttempts: 1 });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText(/Simulated extraction failure/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(/Version 84 installed/i).first()).toBeVisible();
  });

  test('HVSC ingestion failure shows retry', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0, failStage: 'ingest', failInstallAttempts: 1 });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText(/Simulated ingestion failure/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(/Version 84 installed/i).first()).toBeVisible();
  });
});

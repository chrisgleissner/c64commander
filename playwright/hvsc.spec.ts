import { test, expect, type Page, type Route, type ConsoleMessage } from '@playwright/test';
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

  type InstallOptions = { installedVersion: number; failCheck?: boolean; failInstall?: boolean };

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
      }: {
        baseUrl: string;
        baseline: typeof hvscServer.baseline;
        update: typeof hvscServer.update;
        c64BaseUrl: string;
        installedVersion: number;
        failCheck: boolean;
        failInstall: boolean;
      }) => {
        const listeners: Array<(event: any) => void> = [];
        const now = () => Date.now();

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
            if (failInstall) throw new Error('Simulated ingestion failure');
            state.ingestionState = 'installing';
            if (state.installedVersion === 0) {
              emit({ phase: 'download', message: 'Downloading HVSC…', percent: 10 });
              await fetch(`${baseUrl}/hvsc/archive/baseline`).then((res) => res.arrayBuffer());
              emit({ phase: 'ingest', message: 'Ingesting HVSC…', percent: 60 });
              state.songs = mergeSongs([...baseline.songs]);
              state.installedBaselineVersion = baseline.version;
              state.installedVersion = baseline.version;
            }
            if (state.installedVersion < update.version) {
              emit({ phase: 'download', message: 'Downloading update…', percent: 70 });
              await fetch(`${baseUrl}/hvsc/archive/update`).then((res) => res.arrayBuffer());
              emit({ phase: 'ingest', message: 'Applying update…', percent: 90 });
              state.songs = mergeSongs([...state.songs, ...update.songs]);
              state.installedVersion = update.version;
            }
            state.ingestionState = 'ready';
            emit({ phase: 'done', message: 'Ready', percent: 100 });
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
      },
      {
        baseUrl: hvscServer.baseUrl,
        baseline: hvscServer.baseline,
        update: hvscServer.update,
        c64BaseUrl: c64Server.baseUrl,
        installedVersion: options.installedVersion,
        failCheck: options.failCheck ?? false,
        failInstall: options.failInstall ?? false,
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
    await expect(page.getByText('Version 84 installed.', { exact: true }).first()).toBeVisible();
  });

  test('HVSC install -> play sends SID to C64U', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0 });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText('Version 84 installed.', { exact: true }).first()).toBeVisible();

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
    await expect(page.getByText('Version 84 installed.', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    await expect(page.getByText(/\.sid$/i).first()).toBeVisible();
  });

  test('HVSC update check failure surfaces error', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0, failCheck: true });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText('Simulated update check failure', { exact: true }).first()).toBeVisible();
  });

  test('HVSC ingestion failure surfaces error', async ({ page }: { page: Page }) => {
    await installMocks(page, { installedVersion: 0, failInstall: true });
    await page.goto('/music');
    await page.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText('Simulated ingestion failure', { exact: true }).first()).toBeVisible();
  });
});

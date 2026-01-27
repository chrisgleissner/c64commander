import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';

type HvscFixture = {
  version: number;
  songs: Array<{ virtualPath: string; fileName: string; dataBase64: string; durationSeconds?: number }>;
};

const configState = JSON.parse(
  fs.readFileSync(path.resolve('playwright/fixtures/c64u/configState.json'), 'utf8'),
) as Record<string, Record<string, any>>;

const baselineFixture = JSON.parse(
  fs.readFileSync(path.resolve('playwright/fixtures/hvsc/baseline.json'), 'utf8'),
) as HvscFixture;

const primarySong = baselineFixture.songs[0];
const fixtureBase64 = primarySong?.dataBase64 ?? '';

const buildSnapshotData = () => {
  const data: Record<string, any> = {};
  Object.entries(configState).forEach(([category, items]) => {
    const payloadItems: Record<string, any> = {};
    Object.entries(items).forEach(([name, entry]) => {
      payloadItems[name] = {
        selected: entry.value,
        options: entry.options ?? [],
        details: entry.details ?? undefined,
      };
    });
    data[category] = { [category]: { items: payloadItems }, errors: [] };
  });
  return data;
};

const initialSnapshot = {
  savedAt: new Date().toISOString(),
  data: buildSnapshotData(),
};

export const uiFixtures = {
  configState,
  initialSnapshot,
  fixtureBase64,
};

export async function seedUiMocks(page: Page, baseUrl: string) {
  await page.addInitScript(
    ({ baseUrl: baseUrlArg, songData, snapshot }: { baseUrl: string; songData: string; snapshot: unknown }) => {
      try {
        delete (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
      } catch (error) {
        console.warn('Unable to clear showDirectoryPicker', error);
      }
      const host = baseUrlArg?.replace(/^https?:\/\//, '');
      try {
        if (!localStorage.getItem('c64u_password')) {
          localStorage.setItem('c64u_password', '');
        }
        localStorage.setItem('c64u_device_host', host || 'c64u');
        localStorage.setItem(`c64u_initial_snapshot:${baseUrlArg}`, JSON.stringify(snapshot));
        sessionStorage.setItem(`c64u_initial_snapshot_session:${baseUrlArg}`, '1');
      } catch {
        return;
      }

      const listeners: Array<(event: any) => void> = [];
      const song = {
        id: 1,
        virtualPath: '/DEMOS/0-9/10_Orbyte.sid',
        fileName: '10_Orbyte.sid',
        durationSeconds: 77,
        dataBase64: songData,
      };

      window.__hvscMock__ = {
        addListener: (_event: string, listener: (event: any) => void) => {
          listeners.push(listener);
          return { remove: async () => {} };
        },
        getHvscStatus: async () => ({
          installedBaselineVersion: 83,
          installedVersion: 84,
          ingestionState: 'ready',
          lastUpdateCheckUtcMs: Date.now(),
          ingestionError: null as string | null,
        }),
        checkForHvscUpdates: async () => ({
          latestVersion: 84,
          installedVersion: 84,
          baselineVersion: null as number | null,
          requiredUpdates: [] as number[],
        }),
        installOrUpdateHvsc: async () => ({
          installedBaselineVersion: 83,
          installedVersion: 84,
          ingestionState: 'ready',
          lastUpdateCheckUtcMs: Date.now(),
          ingestionError: null as string | null,
        }),
        cancelHvscInstall: async () => {},
        getHvscFolderListing: async ({ path }: { path: string }) => {
          const normalized = path || '/';
          if (normalized === '/') {
            return { path: '/', folders: ['/DEMOS/0-9'], songs: [] as Array<any> };
          }
          if (normalized === '/DEMOS/0-9') {
            return {
              path: normalized,
              folders: [],
              songs: [
                {
                  id: song.id,
                  virtualPath: song.virtualPath,
                  fileName: song.fileName,
                  durationSeconds: song.durationSeconds,
                },
              ],
            };
          }
          return { path: normalized, folders: [], songs: [] };
        },
        getHvscSong: async ({ id, virtualPath }: { id?: number; virtualPath?: string }) => {
          if (id !== song.id && virtualPath !== song.virtualPath) throw new Error('Song not found');
          return {
            id: song.id,
            virtualPath: song.virtualPath,
            fileName: song.fileName,
            durationSeconds: song.durationSeconds,
            dataBase64: song.dataBase64,
          };
        },
        getHvscDurationByMd5: async () => ({
          durationSeconds: 42,
        }),
      };

    },
    { baseUrl: baseUrl, songData: fixtureBase64, snapshot: initialSnapshot },
  );
}

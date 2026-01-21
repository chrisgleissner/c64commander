import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

test.describe('Coverage probes', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('exercises internal helpers for coverage', async ({ page }: { page: Page }) => {
    await page.goto('/play');

    const results = await page.evaluate(async () => {
      const errors: string[] = [];

      const ensure = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (error) {
          errors.push(`${label}: ${(error as Error).message}`);
        }
      };

      await ensure('songlengths', async () => {
        const { parseSonglengths } = await import('/src/lib/sid/songlengths.ts');
        const parsed = parseSonglengths('; /demo.sid\nabcdef=0:30\n');
        if (!parsed.pathToSeconds.has('/demo.sid')) {
          throw new Error('Songlengths path not parsed');
        }
      });

      await ensure('audio mixer', async () => {
        const { normalizeAudioMixerValue, isAudioMixerValueEqual, resolveAudioMixerResetValue } = await import(
          '/src/lib/config/audioMixer.ts'
        );
        const volReset = await resolveAudioMixerResetValue('Audio Mixer', 'Vol UltiSid 1', ['+1 dB', '0 dB']);
        const panReset = await resolveAudioMixerResetValue('Audio Mixer', 'Pan 1', ['Left', 'Center', 'Right']);
        const otherReset = await resolveAudioMixerResetValue('Audio Mixer', 'Other', ['A', 'B']);
        if (!isAudioMixerValueEqual(volReset, '0 dB')) {
          throw new Error('Volume reset not resolved');
        }
        if (!isAudioMixerValueEqual(panReset, 'Center')) {
          throw new Error('Pan reset not resolved');
        }
        if (otherReset !== undefined) {
          throw new Error('Unexpected reset for non-audio mixer item');
        }
        normalizeAudioMixerValue(' 0 dB');
      });

      await ensure('hvsc source', async () => {
        (window as Window & { __hvscMock__?: Record<string, any> }).__hvscMock__ = {
          getHvscFolderListing: async ({ path }: { path: string }) => {
            if (!path || path === '/') {
              return { path: '/', folders: ['/TEST'], songs: [] };
            }
            if (path === '/TEST') {
              return {
                path,
                folders: [],
                songs: [{ id: 1, virtualPath: '/TEST/test.sid', fileName: 'test.sid', durationSeconds: 5 }],
              };
            }
            return { path, folders: [], songs: [] };
          },
          getHvscSong: async ({ id }: { id?: number }) => {
            if (id !== 1) throw new Error('Missing HVSC song');
            return {
              id: 1,
              virtualPath: '/TEST/test.sid',
              fileName: 'test.sid',
              durationSeconds: 5,
              dataBase64: btoa('TESTDATA'),
            };
          },
        };

        const { HvscSongSource } = await import('/src/lib/hvsc/hvscSource.ts');
        const folders = await HvscSongSource.listFolders('/');
        const songs = await HvscSongSource.listSongs('/TEST');
        const song = await HvscSongSource.getSong(songs[0]);
        if (!folders.length || !songs.length || !song.data) {
          throw new Error('HVSC source failed');
        }
      });

      await ensure('api + playback', async () => {
        const { getC64API } = await import('/src/lib/c64api.ts');
        const { buildPlayPlan, executePlayPlan } = await import('/src/lib/playback/playbackRouter.ts');

        const api = getC64API();
        await api.getVersion();
        await api.getInfo();
        await api.getCategories();
        await api.getCategory('Audio Mixer');
        await api.getConfigItem('Audio Mixer', 'Vol UltiSid 1');
        await api.setConfigValue('Audio Mixer', 'Vol UltiSid 1', '0 dB');
        await api.updateConfigBatch({ 'Audio Mixer': { 'Vol UltiSid 1': '0 dB' } });
        await api.saveConfig();
        await api.loadConfig();
        await api.resetConfig();
        await api.getDrives();
        await api.machineReset();
        await api.machineReboot();
        await api.machinePause();
        await api.machineResume();
        await api.machinePowerOff();
        await api.machineMenuButton();

        const sidFile = new Blob(['PSID'], { type: 'application/octet-stream' });
        const sidPlan = buildPlayPlan({ source: 'local', path: '/test.sid', file: sidFile, durationMs: 1000 });
        await executePlayPlan(api, sidPlan);
        const modPlan = buildPlayPlan({ source: 'ultimate', path: '/music.mod' });
        await executePlayPlan(api, modPlan);
        const prgPlan = buildPlayPlan({ source: 'ultimate', path: '/demo.prg' });
        await executePlayPlan(api, prgPlan, { loadMode: 'load' });
        const crtPlan = buildPlayPlan({ source: 'ultimate', path: '/demo.crt' });
        await executePlayPlan(api, crtPlan);
        const diskPlan = buildPlayPlan({ source: 'ultimate', path: '/disk.d64' });
        await executePlayPlan(api, diskPlan, { drive: 'b', resetBeforeMount: false });
      });

      return { errors };
    });

    expect(results.errors).toEqual([]);
  });
});

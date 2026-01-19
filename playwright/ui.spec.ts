import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';

const fixturePath = path.resolve('tests/fixtures/hvsc/complete/C64Music/DEMOS/0-9/10_Orbyte.sid');
const fixtureData = fs.readFileSync(fixturePath);
const fixtureBase64 = fixtureData.toString('base64');

const configState = {
  'Test Controls': {
    'Volume Level': { value: '1', options: ['0', '1', '2', '3'] },
    Mode: { value: 'Classic', options: ['Classic', 'Modern'] },
    'Enable Feature': { value: 'Enabled', options: ['Enabled', 'Disabled'] },
    'Custom Label': { value: 'Hello' },
    'Network Password': { value: 'secret' },
  },
  'U64 Specific Settings': {
    'System Mode': { value: 'PAL', options: ['PAL', 'NTSC'] },
    'CPU Turbo': { value: 'Off', options: ['Off', 'On'] },
    'HDMI Mode': { value: 'Auto', options: ['Auto', '1080p'] },
  },
  'Audio Mixer': {
    'Vol 1': { value: '0 dB', options: ['-6 dB', '0 dB', '6 dB'] },
    'Pan 1': { value: 'Center', options: ['Left', 'Center', 'Right'] },
  },
  'UltiSID Configuration': {
    'SID Model': { value: '6581', options: ['6581', '8580'] },
  },
  'Drive A Settings': {
    'Drive Type': { value: '1541', options: ['1541', '1571', '1581'] },
  },
  'Drive B Settings': {
    'Drive Type': { value: '1541', options: ['1541', '1571', '1581'] },
  },
};

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

test.describe('UI coverage', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeAll(async () => {
    server = await createMockC64Server(configState);
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ baseUrl, songData, snapshot }) => {
        localStorage.setItem('c64u_base_url', baseUrl);
        localStorage.setItem('c64u_password', '');
        localStorage.setItem('c64u_device_host', 'c64u');
        localStorage.setItem(`c64u_initial_snapshot:${baseUrl}`, JSON.stringify(snapshot));
        sessionStorage.setItem(`c64u_initial_snapshot_session:${baseUrl}`, '1');

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
            ingestionError: null,
          }),
          checkForHvscUpdates: async () => ({
            latestVersion: 84,
            installedVersion: 84,
            baselineVersion: null,
            requiredUpdates: [],
          }),
          installOrUpdateHvsc: async () => ({
            installedBaselineVersion: 83,
            installedVersion: 84,
            ingestionState: 'ready',
            lastUpdateCheckUtcMs: Date.now(),
            ingestionError: null,
          }),
          cancelHvscInstall: async () => {},
          getHvscFolderListing: async ({ path }: { path: string }) => {
            const normalized = path || '/';
            if (normalized === '/') {
              return { path: '/', folders: ['/DEMOS/0-9'], songs: [] };
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
          getHvscSong: async ({ id }: { id?: number }) => {
            if (id !== song.id) throw new Error('Song not found');
            return {
              id: song.id,
              virtualPath: song.virtualPath,
              fileName: song.fileName,
              durationSeconds: song.durationSeconds,
              dataBase64: song.dataBase64,
            };
          },
        };
      },
      { baseUrl: server.baseUrl, songData: fixtureBase64, snapshot: initialSnapshot },
    );
  });

  const clickAllButtons = async (page: Page, scope: Page | ReturnType<Page['locator']>) => {
    const locator = 'locator' in scope ? scope.locator('button') : scope.locator('button');
    const handles = await locator.elementHandles();
    for (const handle of handles) {
      const isClickable = await handle.evaluate((el) => {
        const button = el as HTMLButtonElement;
        const ariaDisabled = button.getAttribute('aria-disabled') === 'true';
        return !button.disabled && !ariaDisabled && button.offsetParent !== null;
      });
      if (!isClickable) continue;
      try {
        await handle.scrollIntoViewIfNeeded();
        await handle.click();
      } catch {
        // Ignore transient DOM changes
      }

      const closeButton = page.getByRole('button', { name: /close|cancel|done|dismiss|back/i }).first();
      if (await closeButton.isVisible()) {
        await closeButton.click();
      }
    }
  };

  test('config widgets read/write, refresh, and revert defaults', async ({ page }) => {
    await page.goto('/config');
    await expect(page.getByRole('button', { name: 'Test Controls' })).toBeVisible();
    await page.getByRole('button', { name: 'Test Controls' }).click();

    const selectTrigger = page.getByLabel('Mode select');
    await selectTrigger.click();
    await page.getByRole('option', { name: 'Modern' }).click();

    const checkbox = page.getByLabel('Enable Feature checkbox');
    await checkbox.click();

    const slider = page.getByLabel('Volume Level slider');
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await slider.click({ position: { x: sliderBox.width - 2, y: sliderBox.height / 2 } });
    }

    const labelInput = page.getByLabel('Custom Label text input');
    await labelInput.fill('World');
    await labelInput.blur();

    const passwordInput = page.getByLabel('Network Password password input');
    await passwordInput.fill('secret2');
    await passwordInput.blur();

    await expect.poll(() => server.getState()['Test Controls']['Mode'].value).toBe('Modern');
    await expect.poll(() => server.getState()['Test Controls']['Enable Feature'].value).toBe('Disabled');
    await expect.poll(() => server.getState()['Test Controls']['Custom Label'].value).toBe('World');
    await expect.poll(() => server.getState()['Test Controls']['Network Password'].value).toBe('secret2');

    const refreshCount = server.requests.length;
    const refreshButton = page.getByRole('button', { name: 'Refresh' }).first();
    await refreshButton.click();
    await expect.poll(() => server.requests.length).toBeGreaterThan(refreshCount);

    await page.goto('/');
    const revertButton = page.getByRole('button', { name: 'Revert' }).first();
    await expect(revertButton).toBeEnabled();
    await revertButton.click();
    await expect.poll(() => server.getState()['Test Controls']['Mode'].value).toBe('Classic');
    await expect.poll(() => server.getState()['Test Controls']['Custom Label'].value).toBe('Hello');

    await page.goto('/config');
    await page.getByRole('button', { name: 'Test Controls' }).click();
    await expect(page.getByLabel('Mode select')).toContainText('Classic');
    await expect(page.getByLabel('Custom Label text input')).toHaveValue('Hello');
  });

  test('clicks widgets across all pages', async ({ page }) => {
    await page.goto('/');
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'Quick', exact: true }).click();
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'Config', exact: true }).click();
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'SID', exact: true }).click();
    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const songRow = page.getByText('10_Orbyte.sid');
    await expect(songRow).toBeVisible();
    await songRow.locator('..').getByRole('button', { name: 'Play' }).click();

    await page.getByRole('tab', { name: 'Local Library' }).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick folder' }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles([{ name: 'local.sid', mimeType: 'audio/sid', buffer: fixtureData }]);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Base URL' }).fill(server.baseUrl);
    await page.getByRole('textbox', { name: 'Device Hostname' }).fill('c64u');
    await page.getByLabel('Network Password').fill('pw');
    await page.getByRole('button', { name: 'Save & Connect' }).click();
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await page.keyboard.press('Escape');
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'Docs', exact: true }).click();
    await clickAllButtons(page, page.locator('main'));
  });
});

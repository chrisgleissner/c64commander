import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve(process.cwd(), 'scripts/validate-playwright-evidence.mjs');

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx2cAAAAASUVORK5CYII=';
const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88]);

const tempDirs: string[] = [];

const createRoot = (prefix: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
};

const writePng = (filePath: string) => {
  writeFileSync(filePath, Buffer.from(pngBase64, 'base64'));
};

const writeWebm = (filePath: string) => {
  writeFileSync(filePath, webmHeader);
};

const writeMeta = (folderPath: string, testFile: string) => {
  writeFileSync(
    path.join(folderPath, 'meta.json'),
    JSON.stringify(
      {
        testId: path.basename(path.dirname(folderPath)),
        deviceId: path.basename(folderPath),
        viewport: { width: 360, height: 740 },
        deviceScaleFactor: 2,
        isMobile: true,
        playwrightProject: path.basename(folderPath),
        timestamp: '2026-03-15T00:00:00.000Z',
        testTitle: 'sample test',
        testFile,
        status: 'passed',
      },
      null,
      2,
    ),
    'utf8',
  );
};

const createEvidenceFolder = ({
  root,
  testId,
  deviceId = 'android-phone',
  testFile,
  withVideo,
}: {
  root: string;
  testId: string;
  deviceId?: string;
  testFile: string;
  withVideo: boolean;
}) => {
  const folder = path.join(root, 'test-results', 'evidence', 'playwright', testId, deviceId);
  const screenshotsDir = path.join(folder, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });
  writePng(path.join(screenshotsDir, '01-final-state.png'));
  writeMeta(folder, testFile);
  if (withVideo) {
    writeWebm(path.join(folder, 'video.webm'));
  }
  return folder;
};

const runValidator = (cwd: string) =>
  spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: 'utf8',
  });

describe('validate-playwright-evidence', () => {
  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('accepts screenshot evidence folders without video.webm', () => {
    const root = createRoot('validate-playwright-evidence-screenshots-');
    createEvidenceFolder({
      root,
      testId: 'screenshots--screenshotsspects--app-screenshots--capture-home-screenshots',
      testFile: '/tmp/repo/playwright/screenshots.spec.ts',
      withVideo: false,
    });

    const result = runValidator(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Playwright evidence validation passed.');
  });

  it('still requires video.webm for non-screenshot evidence folders', () => {
    const root = createRoot('validate-playwright-evidence-regular-');
    createEvidenceFolder({
      root,
      testId: 'playback--playbackspects--playlist-view-all-sheet-stays-viewport-safe-and-scrollable',
      testFile: '/tmp/repo/playwright/playback.spec.ts',
      withVideo: false,
    });

    const result = runValidator(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Expected exactly one video.webm');
  });
});
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PLAY_STORE_LOGO_RELATIVE_PATH,
  PLAY_STORE_OUTPUT_RELATIVE_PATH,
  PLAY_STORE_SCREENSHOT_SOURCES,
  resolvePlayStoreAssetPaths,
} from '../../../scripts/generate-play-assets.mjs';

describe('generate-play-assets paths', () => {
  it('targets the current docs tree for logo, output, and screenshots', () => {
    expect(PLAY_STORE_LOGO_RELATIVE_PATH).toBe(path.join('docs', 'img', 'c64commander.png'));
    expect(PLAY_STORE_OUTPUT_RELATIVE_PATH).toBe(path.join('docs', 'site', 'play-store'));
    expect(PLAY_STORE_SCREENSHOT_SOURCES).toEqual([
      ['docs/img/app/home/00-overview-light.png', 'app-home.png'],
      ['docs/img/app/play/01-overview.png', 'app-play.png'],
      ['docs/img/app/disks/01-overview.png', 'app-disks.png'],
      ['docs/img/app/config/01-categories.png', 'app-configuration.png'],
      ['docs/img/app/config/profiles/expanded/01-overview.png', 'app-configuration-expanded.png'],
      ['docs/img/app/settings/01-overview.png', 'app-settings.png'],
      ['docs/img/app/docs/01-overview.png', 'app-documentation.png'],
    ]);
  });

  it('resolves output folders beneath docs/site/play-store', () => {
    const workspaceRoot = '/tmp/c64commander';
    expect(resolvePlayStoreAssetPaths(workspaceRoot)).toEqual({
      logoPath: path.join(workspaceRoot, 'docs', 'img', 'c64commander.png'),
      outDir: path.join(workspaceRoot, 'docs', 'site', 'play-store'),
      screenshotsDir: path.join(workspaceRoot, 'docs', 'site', 'play-store', 'screenshots'),
    });
  });
});

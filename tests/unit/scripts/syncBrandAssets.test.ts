import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { syncBrandAssets } from '../../../scripts/sync-brand-assets.mjs';

const tempDirs: string[] = [];

const createTempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const buildVariantsYaml = () =>
  [
    'schema_version: 1',
    '',
    'repo:',
    '  default_variant: c64commander',
    '  publish_defaults:',
    '    release:',
    '      - c64commander',
    '',
    'variants:',
    '  c64commander:',
    '    display_name: C64 Commander',
    '    app_id: c64commander',
    '    description: Configure and control your Commodore 64 Ultimate over your local network.',
    '    exported_file_basename: c64commander',
    '    platform:',
    '      android:',
    '        application_id: uk.gleissner.c64commander',
    '        custom_url_scheme: uk.gleissner.c64commander',
    '      ios:',
    '        bundle_id: uk.gleissner.c64commander',
    '      web:',
    '        short_name: C64 Commander',
    "        theme_color: '#6C7EB7'",
    "        background_color: '#6C7EB7'",
    '        login_title: C64 Commander Login',
    '        login_heading: C64 Commander',
    '    assets:',
    '      sources:',
    '        icon:',
    '          path: variants/assets/c64commander/icon.png',
    '          format: png',
    '        logo:',
    '          path: variants/assets/c64commander/logo.png',
    '          format: png',
    '        splash:',
    '          path: variants/assets/c64commander/splash.png',
    '          format: png',
    '    runtime:',
    '      endpoints:',
    '        device_host: c64u',
    '  c64u-controller:',
    '    display_name: C64U Controller',
    '    app_id: c64u-controller',
    '    description: Configure and control your Commodore 64 Ultimate over your local network.',
    '    exported_file_basename: c64u-controller',
    '    platform:',
    '      android:',
    '        application_id: uk.gleissner.c64ucontroller',
    '        custom_url_scheme: uk.gleissner.c64ucontroller',
    '      ios:',
    '        bundle_id: uk.gleissner.c64ucontroller',
    '      web:',
    '        short_name: C64U Controller',
    "        theme_color: '#2F6B8B'",
    "        background_color: '#2F6B8B'",
    '        login_title: C64U Controller Login',
    '        login_heading: C64U Controller',
    '    assets:',
    '      sources:',
    '        icon:',
    '          path: variants/assets/c64u-controller/icon.png',
    '          format: png',
    '        logo:',
    '          path: variants/assets/c64u-controller/logo.png',
    '          format: png',
    '        splash:',
    '          path: variants/assets/c64u-controller/splash.png',
    '          format: png',
    '    runtime:',
    '      endpoints:',
    '        device_host: c64u',
    '',
  ].join('\n');

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('sync-brand-assets', () => {
  it('writes identical logo and splash outputs plus a padded icon for every variant', async () => {
    const repoRoot = createTempDir('brand-assets-');
    const variantsPath = path.join(repoRoot, 'variants/variants.yaml');
    const sourceLogoPath = path.join(repoRoot, 'docs/img/c64commander.png');

    mkdirSync(path.dirname(variantsPath), { recursive: true });
    mkdirSync(path.dirname(sourceLogoPath), { recursive: true });
    writeFileSync(variantsPath, buildVariantsYaml());
    await sharp({
      create: {
        width: 240,
        height: 160,
        channels: 4,
        background: { r: 108, g: 126, b: 183, alpha: 1 },
      },
    })
      .png()
      .toFile(sourceLogoPath);

    await syncBrandAssets({ repoRoot, variantsPath, sourceLogoPath });

    const originalLogo = readFileSync(sourceLogoPath);
    const logoPath = path.join(repoRoot, 'variants/assets/c64commander/logo.png');
    const splashPath = path.join(repoRoot, 'variants/assets/c64commander/splash.png');
    const iconPath = path.join(repoRoot, 'variants/assets/c64commander/icon.png');

    expect(readFileSync(logoPath).equals(originalLogo)).toBe(true);
    expect(readFileSync(splashPath).equals(originalLogo)).toBe(true);

    const iconMeta = await sharp(iconPath).metadata();
    expect(iconMeta.width).toBe(1024);
    expect(iconMeta.height).toBe(1024);
    expect(iconMeta.hasAlpha).toBe(true);

    const cornerPixel = await sharp(iconPath).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    const centerPixel = await sharp(iconPath).extract({ left: 512, top: 512, width: 1, height: 1 }).raw().toBuffer();
    expect(cornerPixel[3]).toBe(0);
    expect(centerPixel[3]).toBeGreaterThan(0);
  });

  it('supports check mode and detects drift', async () => {
    const repoRoot = createTempDir('brand-assets-check-');
    const variantsPath = path.join(repoRoot, 'variants/variants.yaml');
    const sourceLogoPath = path.join(repoRoot, 'docs/img/c64commander.png');

    mkdirSync(path.dirname(variantsPath), { recursive: true });
    mkdirSync(path.dirname(sourceLogoPath), { recursive: true });
    writeFileSync(variantsPath, buildVariantsYaml());
    await sharp({
      create: {
        width: 200,
        height: 140,
        channels: 4,
        background: { r: 47, g: 107, b: 139, alpha: 1 },
      },
    })
      .png()
      .toFile(sourceLogoPath);

    await syncBrandAssets({ repoRoot, variantsPath, sourceLogoPath });
    await expect(syncBrandAssets({ repoRoot, variantsPath, sourceLogoPath, check: true })).resolves.toMatchObject({
      changed: false,
    });

    writeFileSync(path.join(repoRoot, 'variants/assets/c64commander/logo.png'), Buffer.from('stale'));
    await expect(syncBrandAssets({ repoRoot, variantsPath, sourceLogoPath, check: true })).rejects.toThrow(
      /out of date/,
    );
  });
});
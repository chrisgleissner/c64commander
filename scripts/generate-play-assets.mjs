import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const rootDir = process.cwd();
export const PLAY_STORE_LOGO_RELATIVE_PATH = path.join('docs', 'img', 'c64commander.png');
export const PLAY_STORE_OUTPUT_RELATIVE_PATH = path.join('docs', 'site', 'play-store');
export const PLAY_STORE_SCREENSHOT_SOURCES = [
  ['docs/img/app/home/00-overview-light.png', 'app-home.png'],
  ['docs/img/app/play/01-overview.png', 'app-play.png'],
  ['docs/img/app/disks/01-overview.png', 'app-disks.png'],
  ['docs/img/app/config/01-categories.png', 'app-configuration.png'],
  ['docs/img/app/config/profiles/expanded/01-overview.png', 'app-configuration-expanded.png'],
  ['docs/img/app/settings/01-overview.png', 'app-settings.png'],
  ['docs/img/app/docs/01-overview.png', 'app-documentation.png'],
];

export const resolvePlayStoreAssetPaths = (workspaceRoot = process.cwd()) => {
  const outDir = path.join(workspaceRoot, PLAY_STORE_OUTPUT_RELATIVE_PATH);
  return {
    logoPath: path.join(workspaceRoot, PLAY_STORE_LOGO_RELATIVE_PATH),
    outDir,
    screenshotsDir: path.join(outDir, 'screenshots'),
  };
};

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

export const main = async () => {
  const { logoPath, outDir, screenshotsDir } = resolvePlayStoreAssetPaths(rootDir);

  if (!fs.existsSync(logoPath)) {
    throw new Error(`Logo not found: ${logoPath}`);
  }

  ensureDir(outDir);
  ensureDir(screenshotsDir);

  const logo = sharp(logoPath);
  const logoMeta = await logo.metadata();
  const logoSize = Math.min(logoMeta.width ?? 0, logoMeta.height ?? 0);

  if (!logoSize) {
    throw new Error('Logo image has invalid dimensions.');
  }

  const iconSize = 512;
  await logo
    .resize(iconSize, iconSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(outDir, 'icon-512.png'));

  const featureWidth = 1024;
  const featureHeight = 500;
  const featureBackground = { r: 10, g: 10, b: 10, alpha: 1 };

  const logoScale = Math.round(Math.min(featureWidth, featureHeight) * 0.6);
  const resizedLogo = await logo
    .resize(logoScale, logoScale, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: featureWidth,
      height: featureHeight,
      channels: 4,
      background: featureBackground,
    },
  })
    .composite([
      {
        input: resizedLogo,
        left: Math.round((featureWidth - logoScale) / 2),
        top: Math.round((featureHeight - logoScale) / 2),
      },
    ])
    .png()
    .toFile(path.join(outDir, 'feature-graphic-1024x500.png'));

  PLAY_STORE_SCREENSHOT_SOURCES.forEach(([sourceRelativePath, targetFileName]) => {
    const source = path.join(rootDir, sourceRelativePath);
    const target = path.join(screenshotsDir, targetFileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target);
    }
  });

  console.log('Play Store assets generated in docs/site/play-store.');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

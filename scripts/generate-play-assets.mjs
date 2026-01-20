import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const rootDir = process.cwd();
const logoPath = path.join(rootDir, 'doc', 'img', 'c64commander.png');
const outDir = path.join(rootDir, 'docs', 'play-store');
const screenshotsDir = path.join(outDir, 'screenshots');

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const main = async () => {
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
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, 'icon-512.png'));

  const featureWidth = 1024;
  const featureHeight = 500;
  const featureBackground = { r: 10, g: 10, b: 10, alpha: 1 };

  const logoScale = Math.round(Math.min(featureWidth, featureHeight) * 0.6);
  const resizedLogo = await logo
    .resize(logoScale, logoScale, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
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

  const screenshots = [
    'app-home.png',
    'app-play.png',
    'app-disks.png',
    'app-configuration.png',
    'app-configuration-expanded.png',
    'app-settings.png',
    'app-documentation.png',
  ];

  screenshots.forEach((file) => {
    const source = path.join(rootDir, 'doc', 'img', file);
    const target = path.join(screenshotsDir, file);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target);
    }
  });

  console.log('Play Store assets generated in docs/play-store.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

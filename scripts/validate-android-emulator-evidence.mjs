#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence', 'maestro');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webmSignature = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const errors = [];

const statSafe = async (target) => {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
};

const readHeader = async (filePath, bytes) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, 0);
    return buffer;
  } finally {
    await handle.close();
  }
};

const validateSignature = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') {
    const header = await readHeader(filePath, pngSignature.length);
    if (!header.equals(pngSignature)) {
      errors.push(`Invalid PNG signature: ${filePath}`);
    }
  } else if (ext === '.webm') {
    const header = await readHeader(filePath, webmSignature.length);
    if (!header.equals(webmSignature)) {
      errors.push(`Invalid WEBM signature: ${filePath}`);
    }
  } else if (ext === '.mp4') {
    const header = await readHeader(filePath, 12);
    if (header.toString('utf8', 4, 8) !== 'ftyp') {
      errors.push(`Invalid MP4 signature: ${filePath}`);
    }
  }
};

const validateFile = async (filePath) => {
  const stat = await statSafe(filePath);
  if (!stat || !stat.isFile()) {
    errors.push(`Missing file: ${filePath}`);
    return;
  }
  if (stat.size === 0) {
    errors.push(`Zero-byte file: ${filePath}`);
    return;
  }
  await validateSignature(filePath);
};

const listDirs = async (dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dirPath, entry.name));
};

const listFiles = async (dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
};

const getEvidenceLeafFolders = async (rootPath) => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const hasScreenshotsDir = entries.some((entry) => entry.isDirectory() && entry.name === 'screenshots');
  const hasVideo = entries.some((entry) => entry.isFile() && entry.name.toLowerCase().startsWith('video.'));

  if (hasScreenshotsDir || hasVideo) {
    return [rootPath];
  }

  const subdirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(rootPath, entry.name));
  if (subdirs.length === 0) {
    return [rootPath];
  }
  return subdirs;
};

const validateEvidenceFolder = async (folderPath) => {
  const files = await listFiles(folderPath);
  const screenshotsDir = path.join(folderPath, 'screenshots');
  const screenshotsStat = await statSafe(screenshotsDir);

  let pngs = [];
  if (screenshotsStat?.isDirectory()) {
    const screenshotFiles = await listFiles(screenshotsDir);
    pngs = screenshotFiles.filter((file) => file.toLowerCase().endsWith('.png'))
      .map((file) => path.join(screenshotsDir, file));
  }

  const videos = files
    .filter((file) => file.toLowerCase() === 'video.webm' || file.toLowerCase() === 'video.mp4')
    .map((file) => path.join(folderPath, file));

  if (pngs.length === 0) {
    errors.push(`No PNG screenshots in ${folderPath}`);
  }
  if (videos.length > 1) {
    errors.push(`Expected at most one video (mp4/webm) in ${folderPath}, found ${videos.length}`);
  }

  const required = ['error-context.md', 'meta.json'];
  for (const req of required) {
    if (!files.includes(req)) {
      errors.push(`Missing ${req} in ${folderPath}`);
    }
  }

  await Promise.all([
    ...pngs,
    ...videos,
    ...required.filter((file) => files.includes(file)).map((file) => path.join(folderPath, file)),
  ].map((filePath) => validateFile(filePath)));
};

const main = async () => {
  const rootStat = await statSafe(evidenceRoot);
  if (!rootStat || !rootStat.isDirectory()) {
    errors.push(`Evidence root missing: ${evidenceRoot}`);
  } else {
    const folders = await listDirs(evidenceRoot);
    if (folders.length === 0) {
      errors.push('No evidence folders found.');
    }
    for (const folder of folders) {
      const leaves = await getEvidenceLeafFolders(folder);
      for (const leaf of leaves) {
        await validateEvidenceFolder(leaf);
      }
    }
  }

  if (errors.length) {
    console.error('Android emulator evidence validation failed:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Android emulator evidence validation passed.');
};

main().catch((error) => {
  console.error('Validation failed with error:', error);
  process.exit(1);
});

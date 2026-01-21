#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const evidenceRoot = path.resolve(process.cwd(), 'test-results', 'evidence');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webmSignature = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

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
  } else if (ext === '.zip') {
    const header = await readHeader(filePath, zipSignature.length);
    if (!header.equals(zipSignature)) {
      errors.push(`Invalid ZIP signature: ${filePath}`);
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

const validateEvidenceFolder = async (folderPath) => {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const pngs = files.filter((file) => file.toLowerCase().endsWith('.png'));
  const videos = files.filter((file) => file.toLowerCase() === 'video.webm');

  if (pngs.length === 0) {
    errors.push(`No PNG screenshots in ${folderPath}`);
  }
  if (videos.length !== 1) {
    errors.push(`Expected exactly one video.webm in ${folderPath}, found ${videos.length}`);
  }

  await Promise.all(files.map((file) => validateFile(path.join(folderPath, file))));
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
      await validateEvidenceFolder(folder);
    }
  }

  if (errors.length) {
    console.error('Playwright evidence validation failed:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Playwright evidence validation passed.');
};

main().catch((error) => {
  console.error('Validation failed with error:', error);
  process.exit(1);
});

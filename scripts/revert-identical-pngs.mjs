#!/usr/bin/env node
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const execFile = promisify(execFileCb);

const toRgba = async (input) => {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
  };
};

const listModifiedPngFiles = async () => {
  const [unstaged, staged] = await Promise.all([
    execFile('git', [
      'diff',
      '--name-only',
      '--diff-filter=AM',
      '--',
      'doc/img/app',
    ]),
    execFile('git', [
      'diff',
      '--name-only',
      '--cached',
      '--diff-filter=AM',
      '--',
      'doc/img/app',
    ]),
  ]);

  const files = new Set(
    `${unstaged.stdout}\n${staged.stdout}`
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.png')),
  );

  return [...files];
};

const loadHeadBlob = async (filePath) => {
  try {
    const { stdout } = await execFile('git', ['show', `HEAD:${filePath}`], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    console.error(
      `[png-prune] Failed to read HEAD blob for ${filePath}:`,
      error,
    );
    return null;
  }
};

const hasPixelDiffFromHead = async (filePath) => {
  const headBlob = await loadHeadBlob(filePath);
  if (!headBlob) return true;

  try {
    const [working, head] = await Promise.all([
      toRgba(await readFile(filePath)),
      toRgba(headBlob),
    ]);

    if (working.width !== head.width || working.height !== head.height) {
      return true;
    }

    return !working.data.equals(head.data);
  } catch (error) {
    console.error(
      `[png-prune] Failed to compare pixels for ${filePath}:`,
      error,
    );
    return true;
  }
};

const revertFile = async (filePath) => {
  try {
    await execFile('git', [
      'restore',
      '--source=HEAD',
      '--staged',
      '--worktree',
      '--',
      filePath,
    ]);
    return true;
  } catch (error) {
    console.error(`[png-prune] Failed to revert ${filePath}:`, error);
    return false;
  }
};

const run = async () => {
  const modifiedFiles = await listModifiedPngFiles();
  if (modifiedFiles.length === 0) {
    console.log('[png-prune] No modified screenshot PNG files detected.');
    return;
  }

  let reverted = 0;
  let kept = 0;

  for (const filePath of modifiedFiles) {
    const hasPixelDiff = await hasPixelDiffFromHead(filePath);
    if (hasPixelDiff) {
      kept += 1;
      continue;
    }

    const ok = await revertFile(filePath);
    if (ok) {
      reverted += 1;
    }
  }

  console.log(
    `[png-prune] scanned=${modifiedFiles.length} reverted=${reverted} kept=${kept}`,
  );
};

run().catch((error) => {
  console.error('[png-prune] Unexpected failure:', error);
  process.exitCode = 1;
});

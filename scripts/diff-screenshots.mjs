#!/usr/bin/env node
/**
 * Generates visual diff images for all modified screenshots in doc/img/app.
 * For each modified PNG, compares HEAD vs working-tree pixels and writes:
 *   .tmp/screenshot-diffs/<relative-path>  — diff image (red overlay on changed pixels)
 *
 * Exit code 0 always; results are written to stdout.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const execFile = promisify(execFileCb);

// ─── helpers ────────────────────────────────────────────────────────────────

// Fuzzy-comparison uses grayscale Mean Absolute Error (MAE) — kept in sync
// with revert-identical-pngs.mjs and playwright/screenshots.spec.ts.
//
// Threshold calibrated from visual inspection of 110 modified screenshots:
//   font-rendering noise peaks at MAE ≈ 4.78 (out of 255)
//   real content changes start at MAE ≈ 5.11
// Threshold set at 5.0 — sits cleanly in the gap with no overlap.
const GRAYSCALE_MAE_THRESHOLD = 5.0;

const toRgba = async (input) => {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** Computes grayscale MAE between two images. Returns null on size mismatch. */
const computeGrayscaleMae = async (aInput, bInput) => {
  const toGrey = async (input) => {
    const { data, info } = await sharp(input, { limitInputPixels: false })
      .grayscale().raw().toBuffer({ resolveWithObject: true });
    return { data, total: info.width * info.height };
  };
  const [a, b] = await Promise.all([toGrey(aInput), toGrey(bInput)]);
  if (a.total !== b.total) return null; // size mismatch
  let sumDiff = 0;
  for (let i = 0; i < a.total; i++) sumDiff += Math.abs(a.data[i] - b.data[i]);
  return { mae: sumDiff / a.total, total: a.total };
};

const listModifiedPngs = async () => {
  const [unstaged, staged] = await Promise.all([
    execFile('git', ['diff', '--name-only', '--diff-filter=AM', '--', 'doc/img/app']),
    execFile('git', ['diff', '--name-only', '--cached', '--diff-filter=AM', '--', 'doc/img/app']),
  ]);
  return [
    ...new Set(
      `${unstaged.stdout}\n${staged.stdout}`
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('.png')),
    ),
  ];
};

const loadHeadBlob = async (filePath) => {
  try {
    const { stdout } = await execFile('git', ['show', `HEAD:${filePath}`], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null; // new file not in HEAD
  }
};

// ─── diff image generation ───────────────────────────────────────────────────

/**
 * Builds a red semi-transparent overlay buffer for pixels that differ between
 * `a` and `b`.  Returns { overlayBuffer, diffCount, totalPixels }.
 */
const buildDiffOverlay = (a, b) => {
  const total = a.width * a.height;
  // Raw RGBA overlay — transparent everywhere, red where pixels differ
  const overlay = Buffer.alloc(total * 4, 0);
  let diffCount = 0;

  for (let i = 0; i < total; i++) {
    const base = i * 4;
    const rA = a.data[base], gA = a.data[base + 1], bA = a.data[base + 2], aA = a.data[base + 3];
    const rB = b.data[base], gB = b.data[base + 1], bB = b.data[base + 2], aB = b.data[base + 3];
    if (rA !== rB || gA !== gB || bA !== bB || aA !== aB) {
      overlay[base]     = 220; // R
      overlay[base + 1] = 0;   // G
      overlay[base + 2] = 0;   // B
      overlay[base + 3] = 160; // A  (semi-transparent ~63%)
      diffCount++;
    }
  }

  return { overlay, diffCount, totalPixels: total };
};

const generateDiffImage = async (filePath, headBlob, outPath) => {
  const [disk, head] = await Promise.all([
    toRgba(await readFile(filePath)),
    toRgba(headBlob),
  ]);

  // Dimension mismatch — just copy disk version with a border comment
  if (disk.width !== head.width || disk.height !== head.height) {
    const note = `SIZE CHANGED: HEAD=${head.width}x${head.height} disk=${disk.width}x${disk.height}`;
    await mkdir(path.dirname(outPath), { recursive: true });
    // Side-by-side: head | disk
    const sideBySideWidth = head.width + disk.width + 4;
    const maxHeight = Math.max(head.height, disk.height);
    const sideBySide = await sharp({
      create: { width: sideBySideWidth, height: maxHeight, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .composite([
        { input: headBlob, left: 0, top: 0 },
        { input: await readFile(filePath), left: head.width + 4, top: 0 },
      ])
      .png()
      .toBuffer();
    await writeFile(outPath, sideBySide);
    return { diffCount: -1, totalPixels: disk.width * disk.height, note };
  }

  const { overlay, diffCount, totalPixels } = buildDiffOverlay(head, disk);

  await mkdir(path.dirname(outPath), { recursive: true });

  if (diffCount === 0) {
    // Pixel-identical — write a greyed-out version so we have proof
    const greyedOut = await sharp(await readFile(filePath))
      .modulate({ saturation: 0, brightness: 1.1 })
      .png()
      .toBuffer();
    await writeFile(outPath, greyedOut);
    return { diffCount: 0, totalPixels };
  }

  // Composite red overlay on top of disk image
  const overlayPng = await sharp(overlay, {
    raw: { width: disk.width, height: disk.height, channels: 4 },
  }).png().toBuffer();

  const diffImage = await sharp(await readFile(filePath))
    .composite([{ input: overlayPng, blend: 'over' }])
    .png()
    .toBuffer();

  await writeFile(outPath, diffImage);
  return { diffCount, totalPixels };
};

// ─── main ────────────────────────────────────────────────────────────────────

const OUT_ROOT = path.resolve('.tmp/screenshot-diffs');

const run = async () => {
  const files = await listModifiedPngs();
  if (files.length === 0) {
    console.log('[diff] No modified screenshot PNGs found.');
    return;
  }

  console.log(`[diff] Checking ${files.length} modified PNG(s)...\n`);

  const results = await Promise.all(
    files.map(async (filePath) => {
      const headBlob = await loadHeadBlob(filePath);
      const relOut = filePath.replace(/^doc\/img\/app\//, '');
      const outPath = path.join(OUT_ROOT, relOut);

      if (!headBlob) {
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, await readFile(filePath));
        return { filePath, status: 'NEW', diffCount: null, totalPixels: null };
      }

      try {
        const { diffCount, totalPixels, note } = await generateDiffImage(filePath, headBlob, outPath);
        if (diffCount === 0) return { filePath, status: 'IDENTICAL', diffCount: 0, totalPixels };
        if (diffCount === -1) return { filePath, status: 'SIZE_CHANGED', diffCount: null, totalPixels, note };

        // Run fuzzy comparison to distinguish rendering noise from real changes.
        const diskBuffer = await readFile(filePath);
        const fuzzy = await computeGrayscaleMae(diskBuffer, headBlob);
        if (fuzzy && fuzzy.mae < GRAYSCALE_MAE_THRESHOLD) {
          return { filePath, status: 'FUZZY_IDENTICAL', diffCount, mae: fuzzy.mae, totalPixels };
        }
        return { filePath, status: 'CHANGED', diffCount, mae: fuzzy?.mae ?? null, totalPixels };
      } catch (err) {
        return { filePath, status: 'ERROR', error: String(err) };
      }
    }),
  );

  // ── summary ────────────────────────────────────────────────────────────────
  const identical      = results.filter((r) => r.status === 'IDENTICAL');
  const fuzzyIdentical = results.filter((r) => r.status === 'FUZZY_IDENTICAL');
  const changed        = results.filter((r) => r.status === 'CHANGED');
  const newFiles       = results.filter((r) => r.status === 'NEW');
  const errors         = results.filter((r) => r.status === 'ERROR');
  const sizeChg        = results.filter((r) => r.status === 'SIZE_CHANGED');

  console.log('┌──────────────────────────────────────────────────────────────────────────────────────');
  console.log(`│  RESULT: ${changed.length} real changes  |  ${fuzzyIdentical.length} fuzzy-identical (rendering noise)  |  ${identical.length} exact-identical  |  ${sizeChg.length} size-changed  |  ${newFiles.length} new  |  ${errors.length} errors`);
  console.log('└──────────────────────────────────────────────────────────────────────────────────────\n');

  if (fuzzyIdentical.length > 0) {
    console.log('~ FUZZY-IDENTICAL — rendering noise only, will be reverted by pre-commit hook:');
    for (const r of fuzzyIdentical) {
      const rawPct = ((r.diffCount / r.totalPixels) * 100).toFixed(4);
      console.log(`   FUZZY  ${r.filePath}  (raw: ${r.diffCount.toLocaleString()} px ${rawPct}%  |  MAE=${r.mae.toFixed(4)})`);
    }
    console.log();
  }

  if (identical.length > 0) {
    console.log('= EXACT-IDENTICAL (binary diff but zero pixel diff):');
    for (const r of identical) {
      console.log(`   IDENTICAL  ${r.filePath}`);
    }
    console.log();
  }

  if (changed.length > 0) {
    console.log('✓ REAL CHANGES (legitimate, will be committed):');
    for (const r of changed) {
      const pct = ((r.diffCount / r.totalPixels) * 100).toFixed(4);
      const maeStr = r.mae != null ? `  MAE=${r.mae.toFixed(4)}` : '';
      console.log(`   CHANGED  ${r.filePath}  (${r.diffCount.toLocaleString()} px, ${pct}%${maeStr})`);
    }
    console.log();
  }

  if (sizeChg.length > 0) {
    console.log('↔ SIZE CHANGED:');
    for (const r of sizeChg) console.log(`   SIZE  ${r.filePath}  ${r.note ?? ''}`);
    console.log();
  }

  if (newFiles.length > 0) {
    console.log('+ NEW files (not in HEAD):');
    for (const r of newFiles) console.log(`   NEW  ${r.filePath}`);
    console.log();
  }

  if (errors.length > 0) {
    console.log('✗ ERRORS:');
    for (const r of errors) console.log(`   ERROR  ${r.filePath}  ${r.error}`);
    console.log();
  }

  console.log(`[diff] Diff images written to: ${OUT_ROOT}`);
  console.log('[diff] Grey = exact-identical. Red overlay = changed pixels (FUZZY and CHANGED both get overlays).');
};

run().catch((err) => {
  console.error('[diff] Fatal:', err);
  process.exitCode = 1;
});

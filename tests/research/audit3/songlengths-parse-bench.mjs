/**
 * Audit 3 — Songlengths.md5 path extraction benchmark
 *
 * Tests the feasibility of deriving all HVSC song paths from
 * the Songlengths.md5 comment lines instead of walking the
 * extracted filesystem tree.
 *
 * Usage: node tests/research/audit3/songlengths-parse-bench.mjs
 */

import { readFileSync, existsSync } from 'fs';

// Generate a synthetic Songlengths.md5-style file with ~60k entries
function generateSyntheticSonglengthsMd5(songCount) {
  const lines = [];
  lines.push('[Database]');
  lines.push(`; Generated for benchmark: ${songCount} songs`);

  const categories = [
    'DEMOS', 'GAMES', 'MUSICIANS', 'POKE_SIDS', 'Compute_Gazette_SID_Collection',
    'HVSC_Specials', 'DRAX', 'Sidwave', 'Unknown',
  ];

  for (let i = 0; i < songCount; i++) {
    const cat = categories[i % categories.length];
    const subfolder = String.fromCharCode(65 + (i % 26));
    const fileName = `${subfolder}_song_${i}.sid`;
    const md5 = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    const durations = `${Math.floor(Math.random() * 5)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;

    lines.push(`; /${cat}/${subfolder}/${fileName}`);
    lines.push(`${md5}=${durations}`);
  }

  return lines.join('\n');
}

// Strategy 1: Regex-based extraction of paths from comment lines
function extractPathsRegex(content) {
  const paths = [];
  const regex = /^; \/(.*\.sid)\s*$/gmi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    paths.push(`/${match[1]}`);
  }
  return paths;
}

// Strategy 2: Line-by-line scan
function extractPathsLineScan(content) {
  const paths = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('; /') && line.toLowerCase().endsWith('.sid')) {
      paths.push(line.substring(2).trim());
    }
  }
  return paths;
}

// Strategy 3: indexOf-based scan (no split)
function extractPathsIndexOf(content) {
  const paths = [];
  let pos = 0;
  const prefix = '; /';
  const suffix = '.sid';
  while (pos < content.length) {
    const lineStart = pos;
    const lineEnd = content.indexOf('\n', pos);
    const end = lineEnd === -1 ? content.length : lineEnd;
    const line = content.substring(lineStart, end);
    if (line.startsWith(prefix) && line.toLowerCase().trimEnd().endsWith(suffix)) {
      paths.push(line.substring(2).trimEnd());
    }
    pos = end + 1;
  }
  return paths;
}

// Build browse entries from extracted paths
function buildBrowseEntriesFromPaths(paths) {
  const songs = {};
  const folderMap = new Map();
  const ensureFolder = (path) => {
    if (folderMap.has(path)) return folderMap.get(path);
    const row = { folders: new Set(), songs: new Set() };
    folderMap.set(path, row);
    return row;
  };
  ensureFolder('/');

  for (const path of paths) {
    const fileName = path.substring(path.lastIndexOf('/') + 1);
    songs[path] = { virtualPath: path, fileName, durationSeconds: null };

    const segments = path.split('/').filter(Boolean);
    let currentPath = '/';
    for (let j = 0; j < segments.length - 1; j++) {
      const parent = ensureFolder(currentPath);
      const nextPath = currentPath === '/' ? `/${segments[j]}` : `${currentPath}/${segments[j]}`;
      parent.folders.add(nextPath);
      ensureFolder(nextPath);
      currentPath = nextPath;
    }
    ensureFolder(currentPath).songs.add(path);
  }

  return { songCount: Object.keys(songs).length, folderCount: folderMap.size };
}

// ── Run benchmarks ──────────────────────────────────────────────

const SONG_COUNT = 60_572;

console.log(`=== Songlengths.md5 Path Extraction Benchmark ===\n`);
console.log(`Generating synthetic Songlengths.md5 with ${SONG_COUNT.toLocaleString()} entries...`);

let t0 = performance.now();
const content = generateSyntheticSonglengthsMd5(SONG_COUNT);
const genMs = performance.now() - t0;
const contentBytes = Buffer.byteLength(content, 'utf-8');
console.log(`  Generated: ${(contentBytes / 1024 / 1024).toFixed(1)} MiB in ${genMs.toFixed(0)} ms\n`);

console.log('--- Path extraction strategies ---\n');

// Strategy 1
t0 = performance.now();
const paths1 = extractPathsRegex(content);
const regexMs = performance.now() - t0;
console.log(`  Regex:      ${paths1.length.toLocaleString()} paths in ${regexMs.toFixed(1)} ms`);

// Strategy 2
t0 = performance.now();
const paths2 = extractPathsLineScan(content);
const lineScanMs = performance.now() - t0;
console.log(`  Line scan:  ${paths2.length.toLocaleString()} paths in ${lineScanMs.toFixed(1)} ms`);

// Strategy 3
t0 = performance.now();
const paths3 = extractPathsIndexOf(content);
const indexOfMs = performance.now() - t0;
console.log(`  indexOf:    ${paths3.length.toLocaleString()} paths in ${indexOfMs.toFixed(1)} ms`);

console.log();

// Build browse index from extracted paths
console.log('--- Browse index construction from extracted paths ---\n');

t0 = performance.now();
const browseResult = buildBrowseEntriesFromPaths(paths1);
const buildMs = performance.now() - t0;
console.log(`  Songs: ${browseResult.songCount.toLocaleString()}, Folders: ${browseResult.folderCount.toLocaleString()}`);
console.log(`  Build time: ${buildMs.toFixed(1)} ms`);

console.log();

// Total pipeline: parse + build
const totalMs = Math.min(regexMs, lineScanMs, indexOfMs) + buildMs;
console.log(`--- Total pipeline (best parse + browse index build) ---\n`);
console.log(`  Parse: ${Math.min(regexMs, lineScanMs, indexOfMs).toFixed(1)} ms`);
console.log(`  Build: ${buildMs.toFixed(1)} ms`);
console.log(`  Total: ${totalMs.toFixed(1)} ms`);
console.log(`  vs. Slow I/O BFS (0.5ms/call): ~${(SONG_COUNT * 0.5 / 1000).toFixed(0)} s`);
console.log(`  Speedup: ~${(SONG_COUNT * 0.5 / totalMs).toFixed(0)}x`);

console.log();
console.log('--- Playlist entry construction from paths ---\n');

t0 = performance.now();
const playlistItems = paths1.map((path, i) => ({
  id: `hvsc:${i}:1`,
  label: path.substring(path.lastIndexOf('/') + 1),
  path,
  category: 'sid',
  request: { source: 'hvsc', path, songNr: 1 },
  durationMs: undefined,
  subsongCount: 1,
  sourceId: 'hvsc-library',
  status: 'ready',
}));
const itemBuildMs = performance.now() - t0;
console.log(`  ${playlistItems.length.toLocaleString()} PlaylistItems built in ${itemBuildMs.toFixed(1)} ms`);

// Full pipeline: parse + build browse index + construct playlist items
const fullPipelineMs = Math.min(regexMs, lineScanMs, indexOfMs) + buildMs + itemBuildMs;
console.log(`\n--- Full pipeline (parse + index + items) ---\n`);
console.log(`  Total: ${fullPipelineMs.toFixed(1)} ms`);
console.log(`  Pixel 4 estimate (4x): ${(fullPipelineMs * 4).toFixed(0)} ms`);
console.log(`  Within 2s budget: ${fullPipelineMs * 4 < 2000 ? 'YES' : 'NEEDS WORKER'}`);

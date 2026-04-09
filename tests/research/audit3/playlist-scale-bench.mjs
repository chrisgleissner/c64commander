/**
 * Audit 3 — Playlist scale micro-benchmarks
 *
 * Standalone Node.js script (no framework dependencies).
 * Tests the core computational costs of playlist construction,
 * filtering, and serialization at 60k–100k scale.
 *
 * Usage: node tests/research/audit3/playlist-scale-bench.mjs
 */

const SIZES = [1_000, 10_000, 60_000, 100_000];

// ── Helpers ──────────────────────────────────────────────────────

const randomPath = (i) =>
  `/HVSC/${String.fromCharCode(65 + (i % 26))}/${String.fromCharCode(65 + ((i * 7) % 26))}_folder/song_${i}.sid`;

const randomId = (i) => `hvsc:${i}:1`;

function generatePlaylistItems(count) {
  const items = new Array(count);
  for (let i = 0; i < count; i++) {
    items[i] = {
      id: randomId(i),
      label: `Song ${i}`,
      path: randomPath(i),
      category: 'sid',
      request: { source: 'hvsc', path: randomPath(i), songNr: 1 },
      durationMs: 120_000 + (i % 300) * 1000,
      subsongCount: 1,
      sourceId: 'hvsc-library',
      status: 'ready',
    };
  }
  return items;
}

function timeIt(label, fn, iterations = 1) {
  // Warm up
  fn();
  const t0 = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    fn();
  }
  const elapsed = performance.now() - t0;
  const perIter = elapsed / iterations;
  return { label, totalMs: elapsed, perIterMs: perIter, iterations };
}

// ── Experiment 1: Object allocation cost ─────────────────────────

function benchObjectAllocation(size) {
  return timeIt(`alloc-${size}`, () => generatePlaylistItems(size));
}

// ── Experiment 2: Array spread / append cost ─────────────────────

function benchArraySpreadAppend(size) {
  const existing = generatePlaylistItems(size);
  const batch = generatePlaylistItems(250);
  return timeIt(
    `spread-append-${size}+250`,
    () => {
      const next = [...existing, ...batch]; // This is what setPlaylist does
      return next.length;
    },
    10,
  );
}

// ── Experiment 3: In-memory text filter (linear scan) ────────────

function benchLinearFilter(size) {
  const items = generatePlaylistItems(size);
  const query = 'song_500';
  return timeIt(
    `linear-filter-${size}`,
    () => {
      const results = items.filter((item) => {
        const haystack = [item.label, item.path, item.request.path, item.request.source, item.category]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
      return results.length;
    },
    5,
  );
}

// ── Experiment 4: Map-based ID lookup ────────────────────────────

function benchMapLookup(size) {
  const items = generatePlaylistItems(size);
  const idMap = new Map(items.map((item) => [item.id, item]));
  const lookupIds = items.slice(0, 200).map((item) => item.id);
  return timeIt(
    `map-lookup-200-from-${size}`,
    () => {
      const results = lookupIds.map((id) => idMap.get(id)).filter(Boolean);
      return results.length;
    },
    100,
  );
}

// ── Experiment 5: Serialization cost (JSON.stringify) ────────────

function benchSerialization(size) {
  const items = generatePlaylistItems(size);
  return timeIt(`json-stringify-${size}`, () => {
    const json = JSON.stringify(items);
    return json.length;
  });
}

// ── Experiment 6: Sort cost ──────────────────────────────────────

function benchSort(size) {
  const items = generatePlaylistItems(size);
  return timeIt(
    `sort-by-path-${size}`,
    () => {
      const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));
      return sorted.length;
    },
    3,
  );
}

// ── Experiment 7: buildSnapshotKey cost (FNV-1a over all items) ──

function benchSnapshotKey(size) {
  const items = generatePlaylistItems(size);
  return timeIt(
    `snapshot-key-${size}`,
    () => {
      let hash = 2166136261;
      const write = (value) => {
        for (let i = 0; i < value.length; i++) {
          hash ^= value.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
      };
      write(String(items.length));
      for (const item of items) {
        write(item.id);
        write(item.path);
        write(item.request.source);
        write(String(item.request.songNr ?? 1));
        write(item.status ?? 'ready');
        write(item.addedAt ?? '');
      }
      return hash >>> 0;
    },
    3,
  );
}

// ── Experiment 8: Simulated slow I/O path enumeration ────────────

function benchSlowPathEnumeration(size) {
  // Simulate readdir + stat at 0.5ms per call (realistic for Android Capacitor bridge)
  const SIMULATED_LATENCY_MS = 0.5;
  const paths = Array.from({ length: size }, (_, i) => randomPath(i));
  const folderSet = new Set();
  paths.forEach((p) => {
    const parts = p.split('/');
    for (let i = 1; i < parts.length - 1; i++) {
      folderSet.add(parts.slice(0, i + 1).join('/'));
    }
  });
  const folders = [...folderSet];

  // Simulate BFS folder traversal with latency
  const totalCalls = folders.length + size; // readdir per folder + stat per file
  const estimatedMs = totalCalls * SIMULATED_LATENCY_MS;

  return {
    label: `slow-io-enum-${size}`,
    totalMs: estimatedMs,
    perIterMs: estimatedMs,
    iterations: 1,
    detail: {
      folders: folders.length,
      files: size,
      totalBridgeCalls: totalCalls,
      simulatedLatencyPerCallMs: SIMULATED_LATENCY_MS,
    },
  };
}

// ── Experiment 9: Browse index construction ──────────────────────

function benchBrowseIndexConstruction(size) {
  const entries = Array.from({ length: size }, (_, i) => ({
    path: randomPath(i),
    name: `song_${i}.sid`,
    type: 'sid',
    durationSeconds: null,
  }));

  return timeIt(
    `browse-index-build-${size}`,
    () => {
      const songs = {};
      const folderMap = new Map();
      const ensureFolder = (path) => {
        if (folderMap.has(path)) return folderMap.get(path);
        const row = { folders: new Set(), songs: new Set() };
        folderMap.set(path, row);
        return row;
      };
      ensureFolder('/');

      for (const entry of entries) {
        const normalizedPath = entry.path.startsWith('/') ? entry.path : `/${entry.path}`;
        songs[normalizedPath] = {
          virtualPath: normalizedPath,
          fileName: entry.name,
          durationSeconds: null,
        };
        const segments = normalizedPath.split('/').filter(Boolean);
        let currentPath = '/';
        for (let j = 0; j < segments.length - 1; j++) {
          const parent = ensureFolder(currentPath);
          const nextPath = currentPath === '/' ? `/${segments[j]}` : `${currentPath}/${segments[j]}`;
          parent.folders.add(nextPath);
          ensureFolder(nextPath);
          currentPath = nextPath;
        }
        ensureFolder(currentPath).songs.add(normalizedPath);
      }

      // Convert to arrays
      const folders = {};
      folderMap.forEach((value, path) => {
        folders[path] = {
          path,
          folders: Array.from(value.folders).sort(),
          songs: Array.from(value.songs).sort(),
        };
      });

      return { songCount: Object.keys(songs).length, folderCount: Object.keys(folders).length };
    },
    3,
  );
}

// ── Experiment 10: Incremental append vs full rebuild ────────────

function benchIncrementalVsRebuild(size) {
  const items = generatePlaylistItems(size);
  const batchSize = 250;

  // Full rebuild: spread + append for each batch
  const rebuildResult = timeIt(
    `full-rebuild-${size}`,
    () => {
      let playlist = [];
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        playlist = [...playlist, ...batch];
      }
      return playlist.length;
    },
  );

  // Incremental: push batches into mutable array, produce final immutable copy
  const incrementalResult = timeIt(
    `incremental-push-${size}`,
    () => {
      const playlist = [];
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        playlist.push(...batch);
      }
      const final = [...playlist]; // Immutable copy for React
      return final.length;
    },
  );

  return [rebuildResult, incrementalResult];
}

// ── Experiment 11: IndexedDB batch write simulation ──────────────

function benchIndexedDbWriteSimulation(size) {
  // Simulate IndexedDB write overhead: ~0.05ms per put in a single transaction
  const IDB_PUT_MS = 0.05;
  const CHUNK_SIZE = 500;
  const chunks = Math.ceil(size / CHUNK_SIZE);
  // Per-chunk: open tx + N puts + commit ≈ 2ms overhead + N * IDB_PUT_MS
  const perChunkMs = 2 + CHUNK_SIZE * IDB_PUT_MS;
  const totalMs = chunks * perChunkMs;

  return {
    label: `idb-write-sim-${size}`,
    totalMs,
    perIterMs: totalMs,
    iterations: 1,
    detail: {
      chunks,
      chunkSize: CHUNK_SIZE,
      perPutMs: IDB_PUT_MS,
      perChunkMs,
    },
  };
}

// ── Run all experiments ──────────────────────────────────────────

console.log('=== Audit 3: Playlist Scale Benchmarks ===\n');
console.log(`Node.js ${process.version}, ${process.platform} ${process.arch}\n`);

const results = [];

for (const size of SIZES) {
  console.log(`--- Scale: ${size.toLocaleString()} items ---`);

  const r1 = benchObjectAllocation(size);
  const r2 = benchArraySpreadAppend(size);
  const r3 = benchLinearFilter(size);
  const r4 = benchMapLookup(size);
  const r5 = benchSerialization(size);
  const r6 = benchSort(size);
  const r7 = benchSnapshotKey(size);
  const r8 = benchSlowPathEnumeration(size);
  const r9 = benchBrowseIndexConstruction(size);
  const [r10a, r10b] = benchIncrementalVsRebuild(size);
  const r11 = benchIndexedDbWriteSimulation(size);

  const group = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10a, r10b, r11];
  for (const r of group) {
    const detailStr = r.detail ? ` ${JSON.stringify(r.detail)}` : '';
    console.log(
      `  ${r.label.padEnd(40)} ${r.perIterMs.toFixed(2).padStart(10)} ms/iter  (${r.iterations} iters, ${r.totalMs.toFixed(2)} ms total)${detailStr}`,
    );
  }
  console.log();
  results.push({ size, benchmarks: group.map((r) => ({ label: r.label, perIterMs: r.perIterMs, detail: r.detail })) });
}

// ── Summary table ────────────────────────────────────────────────

console.log('=== Summary: Dominant Costs at 100k Scale ===\n');
const hundredK = results.find((r) => r.size === 100_000);
if (hundredK) {
  const sorted = [...hundredK.benchmarks].sort((a, b) => b.perIterMs - a.perIterMs);
  for (const b of sorted) {
    console.log(`  ${b.label.padEnd(40)} ${b.perIterMs.toFixed(2).padStart(10)} ms`);
  }
}

console.log('\n=== Key Insights ===\n');
if (hundredK) {
  const spreadCost = hundredK.benchmarks.find((b) => b.label.includes('spread-append'))?.perIterMs ?? 0;
  const filterCost = hundredK.benchmarks.find((b) => b.label.includes('linear-filter'))?.perIterMs ?? 0;
  const serializeCost = hundredK.benchmarks.find((b) => b.label.includes('json-stringify'))?.perIterMs ?? 0;
  const rebuildCost = hundredK.benchmarks.find((b) => b.label.includes('full-rebuild'))?.perIterMs ?? 0;
  const incrementalCost = hundredK.benchmarks.find((b) => b.label.includes('incremental-push'))?.perIterMs ?? 0;
  const slowIoCost = hundredK.benchmarks.find((b) => b.label.includes('slow-io-enum'))?.perIterMs ?? 0;
  const idbCost = hundredK.benchmarks.find((b) => b.label.includes('idb-write-sim'))?.perIterMs ?? 0;

  console.log(`1. Array spread append (per batch of 250 into 100k): ${spreadCost.toFixed(1)} ms`);
  console.log(`   -> At 400 batches (100k/250), total: ${(spreadCost * 400).toFixed(0)} ms`);
  console.log(`   -> This is O(n²) total work.`);
  console.log();
  console.log(`2. Full rebuild via repeated spread (100k): ${rebuildCost.toFixed(1)} ms`);
  console.log(`   Incremental push + final copy (100k): ${incrementalCost.toFixed(1)} ms`);
  console.log(`   Savings: ${((1 - incrementalCost / rebuildCost) * 100).toFixed(0)}%`);
  console.log();
  console.log(`3. Linear filter (100k): ${filterCost.toFixed(1)} ms`);
  console.log(`   -> Below 16ms budget? ${filterCost < 16 ? 'YES' : 'NO'}`);
  console.log(`   -> Below 100ms budget? ${filterCost < 100 ? 'YES' : 'NO (needs optimization)'}`);
  console.log();
  console.log(`4. JSON serialization (100k): ${serializeCost.toFixed(1)} ms`);
  console.log(`   -> This blocks the main thread during playlist persist.`);
  console.log();
  console.log(`5. Slow I/O path enumeration (100k at 0.5ms/call): ${slowIoCost.toFixed(0)} ms (${(slowIoCost / 1000).toFixed(1)} s)`);
  console.log(`   -> This is what happens with BFS folder traversal via Capacitor bridge.`);
  console.log(`   -> Eliminable by reading from browse index instead of filesystem.`);
  console.log();
  console.log(`6. IndexedDB batch write (100k): ${idbCost.toFixed(0)} ms (${(idbCost / 1000).toFixed(1)} s)`);
  console.log(`   -> commitPlaylistSnapshot cost at scale.`);
}

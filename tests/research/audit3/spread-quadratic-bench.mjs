/**
 * Audit 3 — O(n²) spread append regression analysis
 *
 * Demonstrates the quadratic cost of repeated [...prev, ...batch]
 * as used in the current setPlaylist React state pattern.
 *
 * Usage: node tests/research/audit3/spread-quadratic-bench.mjs
 */

const TOTAL = 60_000;
const BATCH_SIZES = [50, 100, 250, 500, 1_000, 5_000, 60_000];

function randomItem(i) {
  return {
    id: `hvsc:${i}:1`,
    label: `Song ${i}`,
    path: `/HVSC/A/song_${i}.sid`,
    category: 'sid',
    request: { source: 'hvsc', path: `/HVSC/A/song_${i}.sid`, songNr: 1 },
    durationMs: 120_000,
    subsongCount: 1,
  };
}

const items = Array.from({ length: TOTAL }, (_, i) => randomItem(i));

console.log(`=== O(n²) Spread Append Analysis ===`);
console.log(`Total items: ${TOTAL.toLocaleString()}\n`);
console.log(`${'Batch'.padEnd(10)} ${'Batches'.padEnd(10)} ${'Strategy'.padEnd(22)} ${'Time (ms)'.padStart(12)} ${'React renders'.padStart(15)}`);
console.log('-'.repeat(69));

for (const batchSize of BATCH_SIZES) {
  const batches = Math.ceil(TOTAL / batchSize);

  // Strategy 1: Spread per batch (current pattern)
  let t0 = performance.now();
  let playlist1 = [];
  for (let i = 0; i < TOTAL; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    playlist1 = [...playlist1, ...batch]; // O(n) per call → O(n²) total
  }
  const spreadMs = performance.now() - t0;

  // Strategy 2: Push per batch, copy at end
  t0 = performance.now();
  const mutable = [];
  for (let i = 0; i < TOTAL; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    mutable.push(...batch);
  }
  const playlist2 = [...mutable]; // single immutable copy
  const pushMs = performance.now() - t0;

  // Strategy 3: Single bulk set
  t0 = performance.now();
  const playlist3 = [...items]; // one copy
  const bulkMs = performance.now() - t0;

  console.log(
    `${String(batchSize).padEnd(10)} ${String(batches).padEnd(10)} ${'spread-per-batch'.padEnd(22)} ${spreadMs.toFixed(1).padStart(12)} ${String(batches).padStart(15)}`,
  );
  console.log(
    `${''.padEnd(10)} ${''.padEnd(10)} ${'push+final-copy'.padEnd(22)} ${pushMs.toFixed(1).padStart(12)} ${String(1).padStart(15)}`,
  );
  console.log(
    `${''.padEnd(10)} ${''.padEnd(10)} ${'single-bulk-set'.padEnd(22)} ${bulkMs.toFixed(1).padStart(12)} ${String(1).padStart(15)}`,
  );
  console.log();
}

// Show the quadratic growth pattern
console.log('=== Quadratic Growth: spread-per-batch at batch=250 ===\n');
const sizes = [1_000, 5_000, 10_000, 30_000, 60_000, 100_000];
for (const size of sizes) {
  const testItems = Array.from({ length: size }, (_, i) => randomItem(i));
  const t0 = performance.now();
  let playlist = [];
  for (let i = 0; i < size; i += 250) {
    const batch = testItems.slice(i, i + 250);
    playlist = [...playlist, ...batch];
  }
  const ms = performance.now() - t0;
  const renderCount = Math.ceil(size / 250);
  console.log(
    `  ${String(size).padStart(8)} items: ${ms.toFixed(1).padStart(8)} ms  (${renderCount} React renders, ${(ms / renderCount).toFixed(2)} ms/render avg)`,
  );
}

console.log('\n=== Mobile Multiplier ===\n');
console.log('Desktop (this machine) baseline for 60k spread-per-batch at batch=250:');
{
  const t0 = performance.now();
  let playlist = [];
  for (let i = 0; i < 60000; i += 250) {
    const batch = items.slice(i, i + 250);
    playlist = [...playlist, ...batch];
  }
  const desktopMs = performance.now() - t0;
  console.log(`  Desktop: ${desktopMs.toFixed(0)} ms`);
  console.log(`  Pixel 4 estimate (3-5x slower JS): ${(desktopMs * 3).toFixed(0)}-${(desktopMs * 5).toFixed(0)} ms`);
  console.log(`  Pixel 4 with GC pressure (5-8x): ${(desktopMs * 5).toFixed(0)}-${(desktopMs * 8).toFixed(0)} ms`);
}

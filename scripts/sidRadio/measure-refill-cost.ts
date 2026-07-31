/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What one SID Radio refill costs at a given station depth.
 *
 * Run:
 *   npx vite-node --script scripts/sidRadio/measure-refill-cost.ts -- --depths=1000,10000,30000,60000
 *
 * The audible dropout investigation established that the expensive thing about a deep station is
 * not the cost of one `computeStation` — that is about 14 ms at 84,000 exclusions — but how many
 * of them a single refill issues. `StationQueueProvider` recomputes whenever its candidate buffer
 * empties, and at depth most candidates are consumed without being emitted, because path
 * resolution against a partial HVSC and the `minSeconds` rule discard them. A refill measured on
 * the Pixel 4 cost 3.9 s against a 150 ms budget, which is roughly 25 computes rather than one
 * slow one.
 *
 * So this harness reports the multiplier directly: computes per refill, candidate yield, and wall
 * time, at several depths. It drives the **production** {@link StationQueueProvider} over the
 * **production** {@link computeStation} against the pinned bundle.
 *
 * `--discard` models the share of candidates a device would throw away (unresolved path or too
 * short). The default 0.6 is deliberately pessimistic: it is the regime the defect lives in, and a
 * harness that resolved every candidate would measure a station nobody has.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import { computeStation } from "@/lib/sidRadio/stationEngine";
import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import { SIDCORR_BUNDLE_PUBLIC_PATH } from "@/lib/sidRadio/sidcorrRelease";
import type { PlaylistItem } from "@/pages/playFiles/types";

const REFILL_LOOKAHEAD = 10;

const numberArg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? Number(raw.slice(name.length + 3)) : fallback;
};

const listArg = (name: string, fallback: number[]): number[] => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw
    ? raw
        .slice(name.length + 3)
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n))
    : fallback;
};

/** Deterministic 32-bit PRNG, so a depth's exclusion set is the same set on every run. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A scattered exclusion set of `depth` ordinals.
 *
 * Scattered rather than contiguous because that is the shape a real session has: a station that
 * has played 60,000 tunes has taken them from all over the corpus, and a contiguous block would
 * leave the walk an untouched region to find candidates in far too easily.
 */
const buildExclusion = (bundle: SidcorrTinyBundle, depth: number, seed: number): number[] => {
  const random = mulberry32(seed);
  const chosen = new Set<number>();
  while (chosen.size < Math.min(depth, bundle.trackCount - 1)) {
    chosen.add(Math.floor(random() * bundle.trackCount));
  }
  return [...chosen];
};

const main = async () => {
  const depths = listArg("depths", [1000, 10000, 30000, 60000]);
  const refills = numberArg("refills", 5);
  const discard = numberArg("discard", 0.6);
  const shuffleSeed = numberArg("shuffle", 12345);

  const bundlePath = path.resolve(process.cwd(), "public", SIDCORR_BUNDLE_PUBLIC_PATH);
  const raw = readFileSync(bundlePath);
  const bundle = parseSidcorrTiny(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);

  console.log(`bundle: ${bundle.trackCount} tracks / ${bundle.fileCount} files / ${bundle.stats.edgeCount} edges`);
  console.log(`refills per depth: ${refills}  modelled discard rate: ${(discard * 100).toFixed(0)}%\n`);
  console.log("depth      refills  computes  computes/refill   yield   median ms   max ms   items");
  console.log("-".repeat(88));

  for (const depth of depths) {
    const exclude = buildExclusion(bundle, depth, depth);
    // A seed that is not itself excluded, so the station can actually start.
    const seedOrdinal = bundle.trackCount - 1;
    const seedMd5 = bundle.resolveTrack(seedOrdinal).md5_48;

    const discardRandom = mulberry32(depth ^ 0x5eed);
    const provider = new StationQueueProvider({
      computeCandidates: async (excludeOrdinals, recentOrdinals, count) =>
        computeStation({
          bundle,
          seed: { kind: "song", md5_48: seedMd5 },
          shuffleSeed,
          exclude: excludeOrdinals,
          recent: recentOrdinals,
          limit: count,
        }),
      // Models the device's two discard paths without needing an HVSC install or songlengths.
      resolvePath: () => (discardRandom() < discard ? null : "/hvsc/measured.sid"),
      buildItem: ({ virtualPath, songIndex, trackOrdinal }) =>
        ({ virtualPath, songIndex, trackOrdinal }) as unknown as PlaylistItem,
      initialExclude: exclude,
      lookahead: REFILL_LOOKAHEAD,
    });

    const durations: number[] = [];
    let items = 0;
    for (let i = 0; i < refills; i += 1) {
      const startedAt = performance.now();
      const result = await provider.refill(REFILL_LOOKAHEAD);
      durations.push(performance.now() - startedAt);
      items += result.items.length;
      if (result.reason) break;
    }
    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] ?? 0;
    const max = durations[durations.length - 1] ?? 0;

    console.log(
      `${String(depth).padStart(6)}  ${String(durations.length).padStart(9)}` +
        `  ${String(provider.engineComputeCalls).padStart(8)}` +
        `  ${(provider.engineComputeCalls / Math.max(durations.length, 1)).toFixed(1).padStart(15)}` +
        `  ${(provider.candidateYield * 100).toFixed(1).padStart(6)}%` +
        `  ${median.toFixed(1).padStart(9)}` +
        `  ${max.toFixed(1).padStart(7)}` +
        `  ${String(items).padStart(6)}`,
    );
  }
};

void main();

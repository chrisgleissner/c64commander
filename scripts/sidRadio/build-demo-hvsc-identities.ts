/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Choose the corpus identities for Demo Mode's HVSC tunes (`DemoHvscArchive.kt` pads each to a full MD5).
 * Run after `npm run sidcorr:fetch`: `npx vite-node --script scripts/sidRadio/build-demo-hvsc-identities.ts`.
 * Song and Taste stations walk out from demo tunes, so tunes come in clusters of graph neighbours. Style
 * stations seed from the whole corpus, so each cluster is anchored on a track many edges point at.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { EMPTY_NEIGHBOR_HOT, parseSidcorrTiny, type SidcorrTinyBundle } from "../../src/lib/sidRadio/sidcorrTiny";
import { SIDCORR_BUNDLE_PUBLIC_PATH, SIDCORR_BUNDLE_SHA256 } from "../../src/lib/sidRadio/sidcorrRelease";

const DEMO_HVSC_IDENTITIES_ASSET = "android/app/src/main/assets/demo-hvsc/identities.txt";

/** The size of the demo collection. `DemoHvscArchive.kt` writes one tune per identity. */
const TUNES = 480;
/**
 * Tunes per neighbourhood. Sizes 5, 8, 12 and 20 all served every station kind in a trial run; 20 kept
 * 78% of neighbour edges inside the collection against 76% for 12, but with 24 anchors instead of 40.
 */
const CLUSTER_SIZE = 12;
/** Fewest demo tunes each style must carry, so no style tile is left with a handful of tunes. */
const MIN_TUNES_PER_STYLE = 40;

const NEIGHBORS_PER_TRACK = 3;

/** Every demo tune is a one-song PSID, so a file with several tunes cannot stand in for one. */
const isSingleTuneTrack = (bundle: SidcorrTinyBundle, ordinal: number): boolean => {
  const file = bundle.resolveTrack(ordinal).fileOrdinal;
  return bundle.fileTrackStart[file + 1] - bundle.fileTrackStart[file] === 1;
};

const inDegree = (bundle: SidcorrTinyBundle, ordinal: number): number =>
  bundle.reverseOffset[ordinal + 1] - bundle.reverseOffset[ordinal];

const forwardNeighbours = (bundle: SidcorrTinyBundle, ordinal: number): number[] => {
  const out: number[] = [];
  for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
    const target = bundle.neighborTargets[ordinal * NEIGHBORS_PER_TRACK + slot];
    if (target !== EMPTY_NEIGHBOR_HOT) out.push(target);
  }
  return out;
};

const adjacentTracks = (bundle: SidcorrTinyBundle, ordinal: number): number[] => [
  ...forwardNeighbours(bundle, ordinal),
  ...bundle.reverseSourcesOf(ordinal),
];

/**
 * Grow one cluster from `anchor`: repeatedly add the unused single-tune track with the most edges into
 * the cluster, preferring the better-referenced track and then the lower ordinal, so the result is a
 * pure function of the bundle.
 */
const growCluster = (bundle: SidcorrTinyBundle, anchor: number, used: Set<number>): number[] => {
  const cluster = [anchor];
  const members = new Set(cluster);
  while (cluster.length < CLUSTER_SIZE) {
    const edgesIntoCluster = new Map<number, number>();
    for (const member of cluster) {
      for (const track of adjacentTracks(bundle, member)) {
        if (members.has(track) || used.has(track) || !isSingleTuneTrack(bundle, track)) continue;
        edgesIntoCluster.set(track, (edgesIntoCluster.get(track) ?? 0) + 1);
      }
    }
    if (edgesIntoCluster.size === 0) break;
    const [next] = [...edgesIntoCluster.entries()].sort(
      ([trackA, edgesA], [trackB, edgesB]) =>
        edgesB - edgesA || inDegree(bundle, trackB) - inDegree(bundle, trackA) || trackA - trackB,
    )[0];
    cluster.push(next);
    members.add(next);
  }
  return cluster;
};

/** The track ordinals of the demo collection, in the order the generator assigns them to tunes. */
const selectDemoHvscTracks = (bundle: SidcorrTinyBundle): number[] => {
  const anchors: number[] = [];
  for (let ordinal = 0; ordinal < bundle.trackCount; ordinal += 1) {
    if (isSingleTuneTrack(bundle, ordinal)) anchors.push(ordinal);
  }
  anchors.sort((a, b) => inDegree(bundle, b) - inDegree(bundle, a) || a - b);

  const selected: number[] = [];
  const used = new Set<number>();
  for (const anchor of anchors) {
    if (selected.length >= TUNES) break;
    if (used.has(anchor)) continue;
    for (const track of growCluster(bundle, anchor, used)) {
      if (selected.length >= TUNES) break;
      selected.push(track);
      used.add(track);
    }
  }
  return selected;
};

const describeSelection = (bundle: SidcorrTinyBundle, tracks: number[]): string[] => {
  const members = new Set(tracks);
  let edges = 0;
  let closedEdges = 0;
  for (const track of tracks) {
    for (const target of forwardNeighbours(bundle, track)) {
      edges += 1;
      if (members.has(target)) closedEdges += 1;
    }
  }
  const perStyle = bundle.styles.map((style) => ({
    key: style.key,
    tunes: tracks.filter((track) => (bundle.styleMask[track] & (1 << style.maskBit)) !== 0).length,
  }));
  const thin = perStyle.filter((style) => style.tunes < MIN_TUNES_PER_STYLE);
  if (thin.length > 0) {
    throw new Error(`styles with fewer than ${MIN_TUNES_PER_STYLE} demo tunes: ${JSON.stringify(thin)}`);
  }
  return [
    `${tracks.length} tunes, ${closedEdges} of ${edges} neighbour edges stay inside the collection`,
    `tunes per style: ${perStyle.map((style) => `${style.key} ${style.tunes}`).join(", ")}`,
  ];
};

const main = () => {
  const root = process.cwd();
  const data = readFileSync(path.resolve(root, "public", SIDCORR_BUNDLE_PUBLIC_PATH));
  const bundle = parseSidcorrTiny(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const tracks = selectDemoHvscTracks(bundle);
  const summary = describeSelection(bundle, tracks);
  const lines = [
    "# Demo Mode HVSC tune identities: md5_48 prefixes from the pinned SID Radio similarity bundle.",
    `# Bundle sha256 ${SIDCORR_BUNDLE_SHA256}.`,
    "# Generated by scripts/sidRadio/build-demo-hvsc-identities.ts. Do not edit by hand.",
    ...tracks.map((track) => bundle.resolveTrack(track).md5_48),
  ];
  const target = path.resolve(root, DEMO_HVSC_IDENTITIES_ASSET);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${lines.join("\n")}\n`);
  process.stdout.write(`${[...summary, `wrote ${DEMO_HVSC_IDENTITIES_ASSET}`].join("\n")}\n`);
};

main();

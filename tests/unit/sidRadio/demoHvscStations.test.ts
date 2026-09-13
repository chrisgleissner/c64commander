/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  md548ForVirtualPath,
  rebuildMd548PathIndex,
  resetMd548PathIndex,
  resolveVirtualPath,
} from "@/lib/sidRadio/md5PathIndex";
import { parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import { SIDCORR_BUNDLE_PUBLIC_PATH } from "@/lib/sidRadio/sidcorrRelease";
import { stylePopulationsFromBundle } from "@/lib/sidRadio/sidRadioWorkerCore";
import { computeStation, type StationSeed } from "@/lib/sidRadio/stationEngine";
import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import { SID_RADIO_STYLE_TILES } from "@/pages/playFiles/hooks/useSidRadio";
import type { PlaylistItem } from "@/pages/playFiles/types";

const repoRoot = process.cwd();
const bundlePath = path.resolve(repoRoot, "public", SIDCORR_BUNDLE_PUBLIC_PATH);
const identitiesPath = path.resolve(repoRoot, "android/app/src/main/assets/demo-hvsc/identities.txt");

// The same names and loops as DemoHvscArchive.generate(), which DemoHvscArchiveTest pins on the Kotlin side.
const COMPOSERS = ["Barlow_Kit", "Sidwell_Anna", "Vance_Ruth", "Okonkwo_Ada", "Lindqvist_Nils", "Moreau_Yves"];
const DEMO_GROUPS = ["0-9", "A-F", "G-L", "M-R", "S-Z"];
const TITLES = [
  "Raster Bar Rag",
  "Sprite Collision",
  "Kernal Panic",
  "Datasette Dreams",
  "Blue Screen Waltz",
  "Loading Screen",
  "Ready Prompt",
  "Border Flicker",
  "Sixty Four Kilobytes",
  "Cassette Rewind",
  "Floppy Shuffle",
  "Interrupt Lullaby",
];

const demoTunePaths = (count: number): string[] => {
  const paths: string[] = [];
  const named = (title: string, suffix: number) => (suffix === 0 ? title : `${title} ${suffix + 1}`);
  let index = 0;
  while (paths.length < Math.floor(count / 2)) {
    const composer = COMPOSERS[index % COMPOSERS.length];
    const title = TITLES[Math.floor(index / COMPOSERS.length) % TITLES.length];
    const suffix = Math.floor(index / (COMPOSERS.length * TITLES.length));
    paths.push(`/MUSICIANS/${composer[0].toUpperCase()}/${composer}/${named(title, suffix)}.sid`);
    index += 1;
  }
  for (const tree of ["DEMOS", "GAMES"]) {
    let group = 0;
    while (paths.length < (tree === "DEMOS" ? Math.floor((count * 3) / 4) : count)) {
      const title = named(TITLES[index % TITLES.length], Math.floor(index / TITLES.length));
      paths.push(`/${tree}/${DEMO_GROUPS[group % DEMO_GROUPS.length]}/${title}.sid`);
      index += 1;
      group += 1;
    }
  }
  return paths;
};

const songlengthsFor = (paths: string[], md5ForTune: (index: number) => string): string =>
  [
    "[Database]",
    ...paths.flatMap((tunePath, index) => {
      const seconds = 45 + (index % 200);
      const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      return [`; ${tunePath}`, `${md5ForTune(index)}=${length}`];
    }),
  ].join("\n");

const committedIdentities = (): string[] =>
  readFileSync(identitiesPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

const loadBundle = (): SidcorrTinyBundle => {
  const data = readFileSync(bundlePath);
  return parseSidcorrTiny(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
};

/** The first refill `useSidRadio.start` asks for, through the production provider and engine. */
const firstBatch = async (
  bundle: SidcorrTinyBundle,
  seed: StationSeed,
  styleFilter: number | null,
  shuffleSeed: number,
  likes: string[] = [],
): Promise<string[]> => {
  const provider = new StationQueueProvider({
    lookahead: 10,
    computeCandidates: async (exclude, recent, count) =>
      computeStation({ bundle, seed, styleFilter, likes, notForMe: [], shuffleSeed, exclude, recent, limit: count }),
    resolvePath: (md5_48) => resolveVirtualPath(md5_48),
    buildItem: ({ virtualPath, songNr }): PlaylistItem => ({
      id: virtualPath,
      request: { source: "hvsc", path: virtualPath, songNr },
      category: "sid",
      label: virtualPath,
      path: virtualPath,
    }),
  });
  const { items } = await provider.refill(10);
  return items.map((item) => item.path);
};

const SHUFFLE_SEEDS = [1, 0x5bf03635, 0xdeadbeef];

// The bundle is git-ignored and fetched by `npm run sidcorr:fetch`. CI fetches it first, so there a
// missing bundle fails the test rather than skipping it.
describe.skipIf(!existsSync(bundlePath) && !process.env.CI)("SID Radio over the Demo Mode HVSC release", () => {
  let bundle: SidcorrTinyBundle;
  const identities = committedIdentities();
  const paths = demoTunePaths(identities.length);
  const demoMd5 = (index: number) => identities[index].padEnd(32, "0");
  const installDemoRelease = () => rebuildMd548PathIndex(songlengthsFor(paths, demoMd5), { force: true });

  beforeAll(() => {
    bundle = loadBundle();
  });

  afterEach(() => {
    resetMd548PathIndex();
  });

  it("starts a Song station from every other demo tune, serving demo tunes", async () => {
    installDemoRelease();
    const installed = new Set(paths);
    const silent: string[] = [];
    for (const [index, tunePath] of paths.entries()) {
      if (index % 2 === 1) continue;
      const md5_48 = md548ForVirtualPath(tunePath);
      const batch = md5_48 ? await firstBatch(bundle, { kind: "song", md5_48 }, null, SHUFFLE_SEEDS[index % 3]) : [];
      if (batch.length === 0) silent.push(tunePath);
      expect(batch.every((served) => installed.has(served))).toBe(true);
    }
    expect(silent).toEqual([]);
  });

  it("starts a station from every populated style tile", async () => {
    installDemoRelease();
    const populations = stylePopulationsFromBundle(bundle);
    const tiles = SID_RADIO_STYLE_TILES.filter((tile) => populations[tile.key] > 0);
    expect(tiles).toHaveLength(SID_RADIO_STYLE_TILES.length);
    const silent: string[] = [];
    for (const tile of tiles) {
      for (const shuffleSeed of SHUFFLE_SEEDS) {
        const batch = await firstBatch(bundle, { kind: "style", styleBit: tile.bit }, tile.bit, shuffleSeed);
        if (batch.length === 0) silent.push(`${tile.key} @ ${shuffleSeed}`);
      }
    }
    expect(silent).toEqual([]);
  });

  it("starts a Taste station from two liked demo tunes, alone and composed with each style", async () => {
    installDemoRelease();
    const silent: string[] = [];
    for (const [first, second] of [
      [0, 1],
      [17, 250],
      [300, 479],
    ]) {
      const likes = [demoMd5(first), demoMd5(second)];
      for (const styleFilter of [null, ...SID_RADIO_STYLE_TILES.map((tile) => tile.bit)]) {
        const batch = await firstBatch(bundle, { kind: "taste" }, styleFilter, SHUFFLE_SEEDS[0], likes);
        if (batch.length === 0) silent.push(`likes ${first},${second} style ${styleFilter}`);
      }
    }
    expect(silent).toEqual([]);
  });

  it("starts no station at all over the placeholder MD5s the generator used to write", async () => {
    const placeholderMd5 = (index: number) => index.toString(16).padStart(32, "0");
    rebuildMd548PathIndex(songlengthsFor(paths, placeholderMd5), { force: true });
    const song = await firstBatch(bundle, { kind: "song", md5_48: md548ForVirtualPath(paths[0])! }, null, 1);
    const style = await firstBatch(bundle, { kind: "style", styleBit: 0 }, 0, 1);
    const taste = await firstBatch(bundle, { kind: "taste" }, null, 1, [placeholderMd5(0), placeholderMd5(1)]);
    expect({ song, style, taste }).toEqual({ song: [], style: [], taste: [] });
  });
});

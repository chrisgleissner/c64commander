/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { bestCompetitionRank } from "./stilCompetition";
import { primaryCredit, sectionStartSeconds, type StilEntry, type StilInfo } from "./stilParser";

/**
 * Closed sets of tunes, read out of STIL.
 *
 * A collection is a list, not a neighbourhood: a SID Radio station built on one plays its members
 * and nothing else. Membership is decided per STIL block, so a `(#3)` block that credits Bach puts
 * only the third tune into Classical, while a file-level block speaks for the file's first tune.
 * Every rule and its measured size are in `docs/plans/sid-station/stil-collections.md`.
 */

export const STIL_COLLECTION_IDS = [
  "winners",
  "screen",
  "classical",
  "games",
  "pioneers",
  "synthpop",
  "remixes",
  "christmas",
] as const;

export type StilCollectionId = (typeof STIL_COLLECTION_IDS)[number];

/**
 * Bumped whenever a rule below changes, so a stored index derived under the old rules is derived
 * again from the STIL already on disk rather than served stale.
 */
export const STIL_COLLECTIONS_VERSION = 2;

/** One member: an index into {@link StilCollectionIndex.paths} and a 1-based tune number. */
export type StilCollectionMember = [pathIndex: number, songNr: number];

export type StilCollectionIndex = {
  version: number;
  /** Every path that belongs to at least one collection, sorted, so members can share them. */
  paths: string[];
  collections: Record<StilCollectionId, StilCollectionMember[]>;
};

/** Credited names that contain a listed composer's surname but belong to someone else. */
const NOT_A_CLASSICAL_COMPOSER = /\b(?:Walter Schumann|Jack Wagner|Le Mele Verdi)\b/g;
const CLASSICAL_COMPOSER =
  /\b(?:Bach|Mozart|Beethoven|Tchaikovsky|Chopin|Grieg|Rossini|Rimsky-Korsakov|Offenbach|H(?:ä|a)ndel|Brahms|Bizet|Vivaldi|Strauss|Verdi|Mussorgsky|Ravel|Debussy|Schubert|Dvo(?:ř|r)(?:á|a)k|Satie|Haydn|Liszt|Mendelssohn|Paganini|Pachelbel|Wagner|Puccini|Albinoni|Saint-Sa(?:ë|e)ns|Khachaturian|Prokofiev|Holst|Elgar|Smetana|Sibelius|Orff|Borodin|Boccherini|Ponchielli|Supp(?:é|e)|Delibes|Purcell|Scarlatti|Telemann|Schumann|Rachmaninoff|Gounod|Massenet|Mascagni|Bellini|Donizetti|Waldteufel|Leh(?:á|a)r|Mouret|Charpentier|Gluck|Clementi|Shostakovich|Stravinsky)\b/;
const ELECTRONIC_PIONEER =
  /\b(?:Jean-Michel Jarre|Kraftwerk|Vangelis|Mike Oldfield|Giorgio Moroder|Yellow Magic Orchestra|Isao Tomita|Tangerine Dream|Klaus Schulze|Gershon Kingsley|Hot Butter|Jan Hammer|Harold Faltermeyer)\b/i;
const SYNTH_POP =
  /\b(?:Depeche Mode|New Order|Pet Shop Boys|Yazoo|Orchestral Manoeuvres|Erasure|Alphaville|A-Ha|Ultravox|Human League|Soft Cell|Eurythmics|Laserdance|Koto|Trans-X|Visage|Tears for Fears|Duran Duran|Howard Jones|Thomas Dolby|Paul Hardcastle|Art of Noise|Bronski Beat|Modern Talking)\b/i;
const CHRISTMAS =
  /\b(?:christmas|xmas|x-mas|jingle bells|one horse open sleigh|silent night|stille nacht|rudolph|deck the hall|tannenbaum|joy to the world|little drummer boy|let it snow|frosty the snowman|feliz navidad|winter wonderland|santa claus)\b|James Lord Pierpont|Joseph Mohr|Johnny Marks/i;
const ON_SCREEN =
  /\[from the (?:[^\]]*\b)?(?:movie|film|tv series|tv show|television|cartoon|animated series|anime|musical)\b/i;
const OTHER_MACHINE_GAME =
  /\[from the (?:arcade game|(?:[^\]]*?\b)?(?:NES|SNES|Famicom|Amiga|PC|MS-DOS|Atari|ST|ZX Spectrum|Spectrum|MSX2?|Mega Drive|Genesis|Master System|Game Boy|GBA|PC Engine|TurboGrafx|Amstrad|CPC|Nintendo|N64|PlayStation|Saturn|Dreamcast|Neo Geo|Plus\/4|VIC-20|BBC Micro|Archimedes|X68000|FM Towns|PC-88|PC-98|Sega)\b[^\]]*\bgame\b)/i;
const COVERS_C64_TUNE =
  /\b(?:covers|remix of|cover of|arrangement of|remake of|covers the version in)\s+\/(?:MUSICIANS|GAMES|DEMOS)\//i;

type Rule = (info: StilInfo) => boolean;

const title = (info: StilInfo) => primaryCredit(info)?.title ?? "";
const artist = (info: StilInfo) => primaryCredit(info)?.artist ?? "";

/**
 * A credit rule that also requires the credited music to open the tune.
 *
 * A first credit timed `(0:24-0:52)` quotes that music partway through a tune whose opening is
 * something else, so the tune is not a member. A medley whose opening section matches is kept: STIL
 * lists sections in the order they play, so the listener hears the collection's music first.
 */
const fromTheStart =
  (rule: Rule): Rule =>
  (info) =>
    (sectionStartSeconds(title(info)) ?? 0) === 0 && rule(info);

const RULES: Record<StilCollectionId, Rule> = {
  winners: (info) => bestCompetitionRank(info.comment) === 1,
  screen: fromTheStart((info) => ON_SCREEN.test(title(info))),
  classical: fromTheStart((info) => CLASSICAL_COMPOSER.test(artist(info).replace(NOT_A_CLASSICAL_COMPOSER, ""))),
  games: fromTheStart((info) => OTHER_MACHINE_GAME.test(title(info))),
  pioneers: fromTheStart((info) => ELECTRONIC_PIONEER.test(artist(info))),
  synthpop: fromTheStart((info) => SYNTH_POP.test(artist(info))),
  remixes: (info) => COVERS_C64_TUNE.test(info.comment ?? ""),
  christmas: fromTheStart((info) => CHRISTMAS.test(title(info)) || CHRISTMAS.test(artist(info))),
};

/** The file's own block, then each `(#N)` block as the tune it names. */
const blocksOf = function* (entry: StilEntry): Generator<[StilInfo, number]> {
  yield [entry, 1];
  for (const [songNr, info] of Object.entries(entry.subsongs ?? {})) yield [info, Number(songNr)];
};

/**
 * Derive every collection in one pass over the parsed document.
 *
 * Measured at 68 ms (median 91 ms) for the real 3.75 MB STIL on a desktop, on top of the parse the
 * ingestion already pays, so it runs right where STIL is stored rather than on demand.
 */
export const deriveStilCollections = (entries: Map<string, StilEntry>): StilCollectionIndex => {
  const members = new Map<StilCollectionId, Array<[string, number]>>(STIL_COLLECTION_IDS.map((id) => [id, []]));
  const paths = new Set<string>();
  for (const [path, entry] of entries) {
    for (const [info, songNr] of blocksOf(entry)) {
      for (const id of STIL_COLLECTION_IDS) {
        if (!RULES[id](info)) continue;
        const list = members.get(id)!;
        const last = list[list.length - 1];
        if (last && last[0] === path && last[1] === songNr) continue;
        list.push([path, songNr]);
        paths.add(path);
      }
    }
  }
  const sortedPaths = [...paths].sort();
  const pathIndex = new Map(sortedPaths.map((path, index) => [path, index]));
  const collections = Object.fromEntries(
    STIL_COLLECTION_IDS.map((id) => [
      id,
      members.get(id)!.map(([path, songNr]): StilCollectionMember => [pathIndex.get(path)!, songNr]),
    ]),
  ) as Record<StilCollectionId, StilCollectionMember[]>;
  return { version: STIL_COLLECTIONS_VERSION, paths: sortedPaths, collections };
};

export const stilCollectionCounts = (index: StilCollectionIndex): Record<StilCollectionId, number> =>
  Object.fromEntries(STIL_COLLECTION_IDS.map((id) => [id, index.collections[id]?.length ?? 0])) as Record<
    StilCollectionId,
    number
  >;

export const isStilCollectionId = (value: unknown): value is StilCollectionId =>
  typeof value === "string" && (STIL_COLLECTION_IDS as readonly string[]).includes(value);

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { EMPTY_NEIGHBOR_HOT, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import {
  DEFAULT_STATION_BALANCE,
  perOrdinalRandom,
  type StationCandidate,
  type StationResult,
} from "@/lib/sidRadio/stationEngine";

/**
 * A collection station: a closed list of tunes, played in a shuffled order that leans toward the
 * listener's likes.
 *
 * The similarity walk cannot carry a collection. Its tunes are rarely each other's neighbours — one
 * Winners tune in ten has another winner among its neighbours — so a walk restricted to the members
 * ran dry after 37–65% of them. Here membership decides WHAT plays and similarity only decides
 * WHEN: a liked tune and its neighbours come earlier, a rejected tune never comes and its neighbours
 * come later. Every member is played once before the station reports itself finished.
 */

/** The members, as parallel arrays so a request crosses into the worker as two flat lists. */
export interface CollectionPool {
  md5_48: string[];
  /** 1-based tune number of the member at the same index. */
  songNr: number[];
}

export interface CollectionStationOptions {
  bundle: SidcorrTinyBundle;
  pool: CollectionPool;
  likes?: readonly string[];
  notForMe?: readonly string[];
  shuffleSeed: number;
  exclude?: Iterable<number>;
  limit?: number;
}

/**
 * How much more likely a liked tune is to come next than an unrated one, and its neighbours by hop.
 *
 * Weights, not ranks: the order stays a shuffle, so a long list of likes still leaves every other
 * member a fair chance rather than sorting them to the back.
 */
const LIKED_WEIGHT = 4;
const LIKE_NEIGHBOUR_WEIGHT_BY_HOP = [2.5, 1.75] as const;
const DEFAULT_LIMIT = 200;
const NEIGHBOURS_PER_TRACK = 3;

const neighboursOf = (bundle: SidcorrTinyBundle, ordinal: number): number[] => {
  const result: number[] = [];
  for (let slot = 0; slot < NEIGHBOURS_PER_TRACK; slot += 1) {
    const target = bundle.neighborTargets[ordinal * NEIGHBOURS_PER_TRACK + slot];
    if (target !== EMPTY_NEIGHBOR_HOT) result.push(target);
  }
  for (const source of bundle.reverseSourcesOf(ordinal)) result.push(source);
  return result;
};

const ordinalsOf = (bundle: SidcorrTinyBundle, md5s: readonly string[]): number[] =>
  md5s.flatMap((md5) => bundle.trackOrdinalsForMd548(md5.slice(0, 12)));

/** Weight multiplier for every tune within two hops of a liked one; the closest hop wins. */
const likeAffinity = (bundle: SidcorrTinyBundle, liked: readonly number[]): Map<number, number> => {
  const weights = new Map<number, number>();
  let frontier = liked;
  for (const weight of LIKE_NEIGHBOUR_WEIGHT_BY_HOP) {
    const next: number[] = [];
    for (const ordinal of frontier) {
      for (const neighbour of neighboursOf(bundle, ordinal)) {
        if ((weights.get(neighbour) ?? 0) >= weight) continue;
        weights.set(neighbour, weight);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  for (const ordinal of liked) weights.set(ordinal, LIKED_WEIGHT);
  return weights;
};

type Member = { ordinal: number; md5_48: string; songNr: number };

/** Width of the ordinal range past the bundle's end that members it does not know are hashed into. */
const UNKNOWN_MEMBER_ORDINAL_SPACE = 2 ** 30;

/**
 * The ordinal for a member the bundle does not know, taken from its identity alone.
 *
 * It is persisted in the station's played set, so it must not depend on the member's place in the
 * pool: an ordinal derived from the pool index changed whenever the pool did, and a resumed station
 * then forgot some tunes it had played and skipped others it had not.
 */
export const unknownMemberOrdinal = (trackCount: number, md5_48: string, songNr: number): number => {
  const key = `${md5_48}#${songNr}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return trackCount + (hash % UNKNOWN_MEMBER_ORDINAL_SPACE);
};

/**
 * Give every member an ordinal the queue provider can exclude.
 *
 * A member the similarity bundle does not know — STIL can name a tune added after the bundle was
 * built — still plays: it gets {@link unknownMemberOrdinal} and takes no part in the likes weighting.
 * Two such members whose hashes collide are resolved in the order of their identities, so adding a
 * member can move only a member it collides with.
 */
const resolveMembers = (bundle: SidcorrTinyBundle, pool: CollectionPool): Member[] => {
  const members: Member[] = [];
  const seen = new Set<number>();
  const unknown = new Map<string, { md5_48: string; songNr: number }>();
  for (let index = 0; index < pool.md5_48.length; index += 1) {
    const md5_48 = pool.md5_48[index].slice(0, 12).toLowerCase();
    const songNr = pool.songNr[index] ?? 1;
    const ordinal = bundle.trackOrdinalsForMd548(md5_48)[songNr - 1];
    if (ordinal === undefined) {
      unknown.set(`${md5_48}#${songNr}`, { md5_48, songNr });
      continue;
    }
    if (seen.has(ordinal)) continue;
    seen.add(ordinal);
    members.push({ ordinal, md5_48, songNr });
  }
  for (const key of [...unknown.keys()].sort()) {
    const { md5_48, songNr } = unknown.get(key)!;
    let ordinal = unknownMemberOrdinal(bundle.trackCount, md5_48, songNr);
    while (seen.has(ordinal)) ordinal += 1;
    seen.add(ordinal);
    members.push({ ordinal, md5_48, songNr });
  }
  return members;
};

export const computeCollectionStation = (options: CollectionStationOptions): StationResult => {
  const { bundle, shuffleSeed } = options;
  const members = resolveMembers(bundle, options.pool);
  if (members.length === 0) return { candidates: [], empty: "no-neighbours" };

  const exclude = new Set<number>(options.exclude ?? []);
  const rejectedMd5s = new Set((options.notForMe ?? []).map((md5) => md5.slice(0, 12).toLowerCase()));
  const affinity = likeAffinity(bundle, ordinalsOf(bundle, options.likes ?? []));
  const rejectedNeighbours = new Map<number, number>();
  for (const ordinal of ordinalsOf(bundle, options.notForMe ?? [])) {
    for (const neighbour of neighboursOf(bundle, ordinal)) {
      rejectedNeighbours.set(neighbour, (rejectedNeighbours.get(neighbour) ?? 0) + 1);
    }
  }

  const keyed: Array<{ member: Member; weight: number; key: number }> = [];
  for (const member of members) {
    if (exclude.has(member.ordinal) || rejectedMd5s.has(member.md5_48)) continue;
    const rejections = rejectedNeighbours.get(member.ordinal) ?? 0;
    const weight =
      (affinity.get(member.ordinal) ?? 1) * Math.pow(DEFAULT_STATION_BALANCE.rejectNeighbourhoodScale, rejections);
    const key = -Math.log(perOrdinalRandom(shuffleSeed, member.ordinal) + 1e-12) / weight;
    keyed.push({ member, weight, key });
  }
  if (keyed.length === 0) return { candidates: [], empty: "exhausted" };
  keyed.sort((a, b) => a.key - b.key || a.member.ordinal - b.member.ordinal);

  const candidates: StationCandidate[] = keyed.slice(0, options.limit ?? DEFAULT_LIMIT).map(({ member, weight }) => ({
    trackOrdinal: member.ordinal,
    md5_48: member.md5_48,
    songNr: member.songNr,
    score: weight,
    reason: "collection",
    // Only this tune: a collection can list several tunes of one file as separate members, and
    // retiring the siblings would silently drop them from the station.
    fileTrackOrdinals: [member.ordinal],
  }));
  return { candidates };
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Does this song sound different on this phone without the C64's ROMs?
 *
 * The answer comes from the embedded SID ROM dependency list (see `embeddedRomDependencyList.ts`),
 * read for the one configuration this phone is actually in: which SID emulation renders the song,
 * and which of the C64's ROMs it was given. Specification: `doc/rom-dependency-list.md` in
 * https://github.com/chrisgleissner/sidflow, section 10.
 *
 * The list is allow-by-default and grades each listed song 0..255 per configuration. A song is
 * reported as `low` only when its grade in this configuration is below the skip threshold (the
 * list's own `recommended_min_grade`); everything else (unlisted, graded at or above the threshold,
 * the reference configuration) is `none` and is never held back. There is no "unknown" grade.
 */

import { loadStoredRoms } from "@/lib/roms/romStore";
import { sha256Hex } from "./digest";
import { loadEmbeddedRomDependencyList, type ReferenceRomHashes } from "./embeddedRomDependencyList";
import { laneGrade, type RomDepLaneName } from "./romDependencyList";
import { addLog } from "@/lib/logging";
import type { SidEmulationEngine } from "@/lib/config/appSettings";

export interface RomDependencyRoms {
  kernal?: Uint8Array;
  basic?: Uint8Array;
  /** Present once the Settings action has read the character ROM; with authentic images this is the reference. */
  chargen?: Uint8Array;
}

/** What the audit measured, for this phone's configuration, or why there is nothing to apply. */
export type ActiveRomLane =
  /** All three authentic ROMs: the reference itself, so the list restricts nothing (§10.1). */
  | { kind: "reference" }
  /** One of the four measured configurations. `approximate` when the engine or the ROM images are only close to the measured ones. */
  | { kind: "lane"; lane: RomDepLaneName; approximate: boolean };

export type RomDependencyVerdict =
  /** Nothing to say: unlisted, graded at or above the threshold, reference configuration, or no list. */
  | { kind: "none" }
  /** Graded below the skip threshold in this configuration (§10.2); 0 means no playback at all. */
  | { kind: "low"; lane: RomDepLaneName; grade: number; approximate: boolean };

/** Thrown from the play path when a song is passed over because it needs the C64's ROMs. */
export class RomDependentSongSkipped extends Error {
  constructor(readonly label: string) {
    super(`${label} needs the C64 ROMs and was skipped`);
    this.name = "RomDependentSongSkipped";
  }
}

/** Thrown when the listener declines to play such a song. */
export class RomDependentSongDeclined extends Error {
  constructor(readonly label: string) {
    super(`${label} needs the C64 ROMs; playback cancelled`);
    this.name = "RomDependentSongDeclined";
  }
}

/**
 * Pick the audited configuration this phone is in (§10.1).
 *
 * The engine is given KERNAL and BASIC only when it has both (`hasCompleteRomSet`), so a lone image
 * counts as none. Two cases are not the audited configuration itself and are marked `approximate`,
 * which the specification allows as a conservative hint: libSidplayEZ (reSIDfp-based but not the
 * audited build, read as reSIDfp) and KERNAL and BASIC images that are not the authentic ones, for
 * example JiffyDOS (read as the KERNAL + BASIC configuration).
 */
export const resolveActiveRomLane = (
  engine: SidEmulationEngine,
  roms: RomDependencyRoms,
  reference: ReferenceRomHashes,
): ActiveRomLane => {
  const family = engine === "sidlite" ? "sidlite" : "residfp";
  const engineApproximate = engine === "sidplayez";
  if (roms.kernal === undefined || roms.basic === undefined) {
    return { kind: "lane", lane: `${family}None`, approximate: engineApproximate };
  }
  const authentic = sha256Hex(roms.kernal) === reference.kernal && sha256Hex(roms.basic) === reference.basic;
  if (authentic && roms.chargen && sha256Hex(roms.chargen) === reference.chargen) return { kind: "reference" };
  // A character ROM that is present but not the authentic one makes this no more than an approximation.
  const exact = authentic && !roms.chargen;
  return { kind: "lane", lane: `${family}KernalBasic`, approximate: engineApproximate || !exact };
};

/** SID header fields do not matter here: the list is keyed by the MD5 of the whole file, as played. */
const md5Of = async (sidBytes: Uint8Array): Promise<string> => {
  const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
  const exact =
    sidBytes.byteOffset === 0 && sidBytes.byteLength === sidBytes.buffer.byteLength
      ? sidBytes.buffer
      : sidBytes.slice().buffer;
  return (await computeSidMd5(exact as ArrayBuffer)).toLowerCase();
};

export interface AssessInput {
  sidBytes: Uint8Array;
  /** One-based, as stored on the playlist item. Absent means the file's first tune, as the engine plays it. */
  songNr: number | null | undefined;
  engine: SidEmulationEngine;
  roms?: RomDependencyRoms;
  /** Skip threshold, 1..listing ceiling+1. Defaults to the list's `recommended_min_grade`; Commander offers no other number. */
  threshold?: number;
}

/**
 * The verdict for one song on this phone. Never throws: any failure is logged and reads as `none`,
 * because a list must not be able to stop a tune from playing (§17.1).
 */
export const assessRomDependency = async ({
  sidBytes,
  songNr,
  engine,
  roms = loadStoredRoms(),
  threshold,
}: AssessInput): Promise<RomDependencyVerdict> => {
  try {
    const loaded = await loadEmbeddedRomDependencyList();
    if (!loaded || loaded.list.header.fileCount === 0) return { kind: "none" };
    const active = resolveActiveRomLane(engine, roms, loaded.referenceRoms);
    if (active.kind !== "lane") return { kind: "none" };
    const subtune = typeof songNr === "number" && Number.isFinite(songNr) ? Math.max(1, Math.trunc(songNr)) : 1;
    const found = loaded.list.lookup(await md5Of(sidBytes), subtune);
    if (!found.listed) return { kind: "none" };
    const grade = laneGrade(found, active.lane);
    // §10.2: a grade below the threshold is skipped; the threshold itself plays, and a grade above the ceiling (such as 254 or 255) is never below a valid threshold.
    if (grade >= (threshold ?? loaded.list.header.recommendedMinGrade)) return { kind: "none" };
    return { kind: "low", lane: active.lane, grade, approximate: active.approximate };
  } catch (error) {
    addLog("warn", "SID ROM dependency check failed; playing the song normally", {
      service: "rom-dependency",
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "none" };
  }
};

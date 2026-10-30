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
 * list's own `recommended_min_grade`); a listed song graded at or above it is `graded`, and an unlisted
 * song or the reference configuration is `none`. Neither is held back. There is no "unknown" grade.
 */

import { loadStoredRoms } from "@/lib/roms/romStore";
import { sha256Hex } from "./digest";
import { loadEmbeddedRomDependencyList, type ReferenceRomHashes } from "./embeddedRomDependencyList";
import { laneGrade, ROM_DEP_LANE_NAMES, type RomDepLaneName, type RomDepLookup } from "./romDependencyList";
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
  /** One of the four measured configurations. `approximate` when the engine is only close to the measured ones. */
  | { kind: "lane"; lane: RomDepLaneName; approximate: boolean }
  /**
   * ROM images that match neither the reference nor a measured configuration, such as JiffyDOS: no measurement
   * applies, so the lowest grade of the four lanes stands in as the conservative hint §10.1 allows.
   */
  | { kind: "lowest" };

export type RomDependencyVerdict =
  /** Nothing to say: unlisted, reference configuration, or no list. */
  | { kind: "none" }
  /** Listed, and graded at or above the threshold in this configuration: the list says it plays here. */
  | { kind: "graded"; lane: RomDepLaneName; grade: number; approximate: boolean }
  /** Graded below the skip threshold in this configuration (§10.2); 0 means no playback at all. */
  | { kind: "low"; lane: RomDepLaneName; grade: number; approximate: boolean };

/** Thrown from the play path when a song is passed over because it needs the C64's ROMs. */
export class RomDependentSongSkipped extends Error {
  constructor(readonly label: string) {
    super(`${label} needs the C64 ROMs and was skipped`);
    this.name = "RomDependentSongSkipped";
  }
}

/**
 * Pick the audited configuration this phone is in (§10.1).
 *
 * The engine is given KERNAL and BASIC only when it has both (`hasCompleteRomSet`), so a lone image
 * counts as none. libSidplayEZ is reSIDfp-based but not the audited build: it is read as reSIDfp and
 * marked `approximate`, a judgement rather than a measurement. Stored images that are not the authentic
 * ones (for example JiffyDOS), or a character ROM that is not, match no measured configuration, so the
 * lowest grade of the four lanes is used instead.
 */
export const resolveActiveRomLane = (
  engine: SidEmulationEngine,
  roms: RomDependencyRoms,
  reference: ReferenceRomHashes,
): ActiveRomLane => {
  const family = engine === "sidlite" ? "sidlite" : "residfp";
  const approximate = engine === "sidplayez";
  if (roms.kernal === undefined || roms.basic === undefined) {
    return { kind: "lane", lane: `${family}None`, approximate };
  }
  const authentic = sha256Hex(roms.kernal) === reference.kernal && sha256Hex(roms.basic) === reference.basic;
  if (!authentic) return { kind: "lowest" };
  if (!roms.chargen) return { kind: "lane", lane: `${family}KernalBasic`, approximate };
  return sha256Hex(roms.chargen) === reference.chargen ? { kind: "reference" } : { kind: "lowest" };
};

/** The grade that applies in `active`, and the lane it was read from. */
const applicableGrade = (found: RomDepLookup, active: Exclude<ActiveRomLane, { kind: "reference" }>) => {
  if (active.kind === "lane")
    return { lane: active.lane, grade: laneGrade(found, active.lane), approximate: active.approximate };
  const lane = ROM_DEP_LANE_NAMES.reduce((low, name) => (laneGrade(found, name) < laneGrade(found, low) ? name : low));
  return { lane, grade: laneGrade(found, lane), approximate: true };
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
    if (active.kind === "reference") return { kind: "none" };
    const subtune = typeof songNr === "number" && Number.isFinite(songNr) ? Math.max(1, Math.trunc(songNr)) : 1;
    const found = loaded.list.lookup(await md5Of(sidBytes), subtune);
    if (!found.listed) return { kind: "none" };
    const applicable = applicableGrade(found, active);
    // §10.2: a grade below the threshold is skipped; the threshold itself plays, and a grade above the ceiling (such as 254 or 255) is never below a valid threshold.
    const low = applicable.grade < (threshold ?? loaded.list.header.recommendedMinGrade);
    return { kind: low ? "low" : "graded", ...applicable };
  } catch (error) {
    addLog("warn", "SID ROM dependency check failed; playing the song normally", {
      service: "rom-dependency",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { kind: "none" };
  }
};

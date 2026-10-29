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
 * The list is allow-by-default. Only a song the audit found to differ, in this configuration, is
 * reported as `incompatible`; everything else (unlisted, measured fine, not measured, or a
 * configuration the audit did not cover) is `none` or `unknown` and is never held back.
 */

import { loadStoredRoms } from "@/lib/roms/romStore";
import { sha256Hex } from "./digest";
import { loadEmbeddedRomDependencyList, type ReferenceRomHashes } from "./embeddedRomDependencyList";
import { laneState, type RomDepLaneName } from "./romDependencyList";
import { addLog } from "@/lib/logging";
import type { SidEmulationEngine } from "@/lib/config/appSettings";

export interface RomDependencyRoms {
  kernal?: Uint8Array;
  basic?: Uint8Array;
  /** Commander never stores one today; present so a build that does gets the reference configuration. */
  chargen?: Uint8Array;
}

/** What the audit measured, for this phone's configuration, or why there is nothing to apply. */
export type ActiveRomLane =
  /** All three authentic ROMs: the reference itself, so the list restricts nothing (§10.1). */
  | { kind: "reference" }
  /** One of the four measured configurations. `approximate` when the engine is a sibling build of the measured one. */
  | { kind: "lane"; lane: RomDepLaneName; approximate: boolean }
  /** ROM images that are not the authentic ones: no measurement applies, so nothing is claimed or held back (§10.1). */
  | { kind: "unmeasured" };

export type RomDependencyVerdict =
  /** Nothing to say: unlisted, measured fine, reference configuration, no list, or no measurement. */
  | { kind: "none" }
  /** Measured to sound different in this configuration (§10.2). */
  | { kind: "incompatible"; lane: RomDepLaneName; approximate: boolean }
  /** The audit could not resolve this configuration. Never treated as incompatible (§10.2). */
  | { kind: "unknown"; lane: RomDepLaneName };

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
 * counts as none. libSidplayEZ is built on reSIDfp but is not the audited build, so it is read as
 * reSIDfp and marked approximate; the spec lets a consumer use that as a conservative hint.
 */
export const resolveActiveRomLane = (
  engine: SidEmulationEngine,
  roms: RomDependencyRoms,
  reference: ReferenceRomHashes,
): ActiveRomLane => {
  const family = engine === "sidlite" ? "sidlite" : "residfp";
  const approximate = engine === "sidplayez";
  const complete = roms.kernal !== undefined && roms.basic !== undefined;
  if (!complete) return { kind: "lane", lane: `${family}None`, approximate };
  const authentic = sha256Hex(roms.kernal!) === reference.kernal && sha256Hex(roms.basic!) === reference.basic;
  if (!authentic) return { kind: "unmeasured" };
  if (roms.chargen) {
    return sha256Hex(roms.chargen) === reference.chargen ? { kind: "reference" } : { kind: "unmeasured" };
  }
  return { kind: "lane", lane: `${family}KernalBasic`, approximate };
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
}: AssessInput): Promise<RomDependencyVerdict> => {
  try {
    const loaded = await loadEmbeddedRomDependencyList();
    if (!loaded || loaded.list.header.fileCount === 0) return { kind: "none" };
    const active = resolveActiveRomLane(engine, roms, loaded.referenceRoms);
    if (active.kind !== "lane") return { kind: "none" };
    const subtune = typeof songNr === "number" && Number.isFinite(songNr) ? Math.max(1, Math.trunc(songNr)) : 1;
    const found = loaded.list.lookup(await md5Of(sidBytes), subtune);
    if (!found.listed) return { kind: "none" };
    const state = laneState(found, active.lane);
    if (state === "incompatible") return { kind: "incompatible", lane: active.lane, approximate: active.approximate };
    if (state === "unknown") return { kind: "unknown", lane: active.lane };
    return { kind: "none" };
  } catch (error) {
    addLog("warn", "SID ROM dependency check failed; playing the song normally", {
      service: "rom-dependency",
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "none" };
  }
};

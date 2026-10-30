/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Should this SID play on the phone, given what the ROMs and the ROM dependency list say?
 *
 * Lifted out of `usePlaybackController.playItem` so that the ROM rules sit in one place: the header
 * test for a tune that declares a BASIC requirement, the stored images, and the embedded list of
 * songs that sound different without the C64's ROMs. The list is described in
 * `docs/internals/sid-playback-architecture.md`; its format in `doc/rom-dependency-list.md` of
 * https://github.com/chrisgleissner/sidflow.
 */

import { toast } from "@/hooks/use-toast";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { loadLocalEngineAutoRoms } from "@/lib/config/appSettings";
import { loadSkipRomDependentSongs } from "@/lib/config/romDependencySettings";
import { addErrorLog, addLog } from "@/lib/logging";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import { romFallbackDecision, type EngineFallbackNotice } from "@/lib/playback/playbackEngineRouting";
import { playbackSidEmulation } from "@/lib/playback/renderedTuneCache";
import { probeSidRenderers } from "@/lib/playback/sidRenderer/sidRendererAvailability";
import { detectRomRequired } from "@/lib/playback/localSidWorkerCore";
import { ensureSystemRoms } from "@/lib/roms/ensureSystemRoms";
import { promptForSystemRoms } from "@/lib/roms/promptForSystemRoms";
import { hasCompleteRomSet } from "@/lib/roms/romStore";
import {
  assessRomDependency,
  RomDependentSongSkipped,
  type RomDependencyVerdict,
} from "@/lib/romDependency/romDependencyPolicy";
import { isDeviceOutOfReach } from "@/pages/playFiles/playableWithoutDevice";
import {
  decideRomListedPlayback,
  romListedSkippedNotice,
  type RomListedDialogChoice,
} from "@/pages/playFiles/romDependencyGate";

export type RomDependencyAsk = () => Promise<RomListedDialogChoice>;

/** The skip notice is shown once per session: a run of skipped songs is not news. */
let skipNoticeShown = false;
export const resetRomSkipNoticeForTests = () => {
  skipNoticeShown = false;
};

/**
 * A C64 that can play the song: connected, not Demo Mode, not offline, and in reach.
 *
 * A connection still being discovered (`UNKNOWN`, `DISCOVERING`) counts as usable. The C64 route
 * discovers on demand (`ensurePlaybackConnection`), so a C64 about to answer plays the song; counting it
 * as absent would pass over songs that machine was about to play.
 */
export const isC64UsableForSid = (deviceOutOfReach: boolean) => {
  const state = getConnectionSnapshot().state;
  return state !== "DEMO_ACTIVE" && state !== "OFFLINE_NO_DEMO" && !deviceOutOfReach;
};

interface RomFidelity {
  romsReady: boolean;
  romRequired: boolean;
  /** The list's answer, when it was consulted. */
  verdict: RomDependencyVerdict | null;
  /** The list grades the song below the threshold here, or the header asks for BASIC that is missing. */
  low: boolean;
  /** The header asks for BASIC that is missing, but the list grades the song as playing well without it. */
  basicCleared: boolean;
}

/**
 * Does the song sound right on this phone? A header that declares BASIC, with BASIC missing, only a C64
 * can satisfy; so when one is usable the list is not consulted. Without one, the list's grade decides,
 * and with no grade the declared requirement itself counts as low fidelity (the format has no "unknown"
 * grade, so this is the header's verdict, not the list's).
 */
const readRomFidelity = async (sidBytes: Uint8Array, songNr: number | null | undefined, c64Usable: boolean) => {
  const romsReady = hasCompleteRomSet();
  const romRequired = detectRomRequired(sidBytes);
  const basicUnmet = romRequired && !romsReady;
  const fidelity: RomFidelity = { romsReady, romRequired, verdict: null, low: false, basicCleared: false };
  if (basicUnmet && c64Usable) return fidelity;
  await probeSidRenderers();
  const verdict = await assessRomDependency({ sidBytes, songNr, engine: playbackSidEmulation() });
  const basicCleared = basicUnmet && verdict.kind === "graded";
  return { ...fidelity, verdict, basicCleared, low: verdict.kind === "low" || (basicUnmet && !basicCleared) };
};

/**
 * Would a playlist moving on by itself pass over this song? Warming its opening would be wasted then.
 * The list is the one already loaded for the song playing, so this costs one MD5.
 */
export const wouldPassOver = async (sidBytes: Uint8Array, songNr: number | null | undefined) => {
  if (!loadSkipRomDependentSongs() || isC64UsableForSid(isDeviceOutOfReach())) return false;
  return (await readRomFidelity(sidBytes, songNr, false)).low;
};

export interface LocalRouteInput {
  file: LocalPlayFile;
  /** One-based, as stored on the playlist item. */
  songNr: number | null | undefined;
  label: string;
  /** The notice the engine choice itself calls for, when it was overridden. */
  selectionNotice: EngineFallbackNotice | null;
  /** Demo Mode or no device: neither can supply the C64's ROMs. */
  noMachineForRoms: boolean;
  /** A C64 that can play the song is reachable: see {@link isC64UsableForSid}. */
  c64Usable: boolean;
  /**
   * The playlist or station is moving on by itself, or the listener pressed Next or Previous: no song
   * was chosen, so one that needs the C64's ROMs is passed over. False when the listener picked this song.
   */
  passOver: boolean;
  /** The song is the one already playing, started again: it was accepted once and is not passed over or asked about. */
  accepted: boolean;
  /** Asks the listener about a chosen song. Absent, nothing can be asked and the song is not played. */
  ask?: RomDependencyAsk;
  /** Checked once the listener answers: false when a Stop, a skip or another launch came while the question was open. */
  stillWanted: () => boolean;
  notify: (notice: EngineFallbackNotice) => void;
  /** The listener said Cancel. Nothing has been stopped yet, so what was playing carries on. */
  onDeclined: () => void;
}

/**
 * Resolves true when the song is to play on this device, false when the C64 takes it, and null when it is
 * not played at all: the listener said Cancel, or something overtook it while they were asked. Throws
 * {@link RomDependentSongSkipped} when a playlist moving on passes over a song that needs the C64's ROMs.
 */
export const resolveLocalRoute = async (input: LocalRouteInput): Promise<boolean | null> => {
  const { notify } = input;
  let routeToLocal = false;
  // `skip`, `ask`, `phone` and `continue` are carried out below, outside the try whose catch would swallow a skip.
  let later: "skip" | "ask" | "phone" | "continue" | null = null;
  try {
    const sidBytes = new Uint8Array(await input.file.arrayBuffer());
    const { romsReady, romRequired, verdict, low, basicCleared } = await readRomFidelity(
      sidBytes,
      input.songNr,
      input.c64Usable,
    );
    if (low) {
      const outcome = decideRomListedPlayback({
        c64Usable: input.c64Usable,
        skipEnabled: loadSkipRomDependentSongs(),
        autoAdvance: input.passOver,
        accepted: input.accepted,
      });
      addLog("info", "Song needs the C64 ROMs on this device", {
        service: "rom-dependency",
        item: input.label,
        songNr: input.songNr ?? null,
        basis: verdict?.kind === "low" ? "list" : "header",
        ...(verdict?.kind === "low"
          ? { lane: verdict.lane, grade: verdict.grade, approximate: verdict.approximate }
          : { lane: null, grade: null, approximate: null }),
        outcome,
      });
      if (outcome === "c64") {
        // The C64 is there, so the ROMs are worth reading from it for the songs that follow.
        if (!romsReady && loadLocalEngineAutoRoms()) void ensureSystemRoms();
      } else {
        later = outcome;
      }
    }
    const decision = romFallbackDecision(romRequired && !basicCleared, romsReady, verdict?.kind === "low");
    if (later === null && decision.route === "local") {
      routeToLocal = true;
      // Neither the simulated device nor an absent one can supply the images.
      if (!romsReady && !input.noMachineForRoms) {
        if (loadLocalEngineAutoRoms()) {
          // Read the images from the connected machine, but do not wait: the tune plays now
          // on the kernal-free emulation and the next worker picks them up. Waiting would
          // put a network round trip in front of the first note.
          void ensureSystemRoms();
        } else {
          // Switched off deliberately, so ask rather than override — but ask where the
          // problem is, with one button that turns it back on and reads them.
          promptForSystemRoms();
        }
      }
    }
    // Where the engine choice was overridden, that is what the listener needs explained.
    const notice = decision.route === "local" && input.selectionNotice ? input.selectionNotice : decision.notice;
    if (later === null && notice) notify(notice);
  } catch (error) {
    addErrorLog("Local engine could not read the SID; using the C64", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      item: input.label,
    });
  }
  if (later === "skip") {
    if (!skipNoticeShown) {
      skipNoticeShown = true;
      toast({ title: "Song skipped", description: romListedSkippedNotice(input.label) });
    }
    throw new RomDependentSongSkipped(input.label);
  }
  if (later === "ask") {
    if (((await input.ask?.()) ?? "cancel") === "cancel") {
      addLog("info", "Song that needs the C64 ROMs not played: the listener said Cancel", { item: input.label });
      input.onDeclined();
      return null;
    }
    if (!input.stillWanted()) {
      addLog("info", "Song that needs the C64 ROMs not played: overtaken while the listener was asked", {
        item: input.label,
      });
      return null;
    }
  }
  if (later === "phone") notify("rom-list-played-anyway");
  return later === null ? routeToLocal : true;
};

/**
 * Play the song at `start`, and when it is passed over for needing the C64's ROMs, the next one `next`
 * names, and so on. False when nothing is left to play (or the walk came back to a song already passed).
 */
export const playPassingOver = async (
  start: number,
  play: (index: number) => Promise<unknown>,
  next: (index: number) => number | null,
): Promise<boolean> => {
  const passedOver = new Set<number>();
  for (let index: number | null = start; index !== null && !passedOver.has(index); index = next(index)) {
    try {
      await play(index);
      return true;
    } catch (error) {
      if (!(error instanceof RomDependentSongSkipped)) throw error;
      addLog("debug", "Passed over a song that needs the C64 ROMs", { index, error: error.message });
      passedOver.add(index);
    }
  }
  return false;
};

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
  RomDependentSongDeclined,
  RomDependentSongSkipped,
} from "@/lib/romDependency/romDependencyPolicy";
import { markPlaybackErrorReported } from "@/pages/playFiles/playbackErrorReported";
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

export interface LocalRouteInput {
  file: LocalPlayFile;
  /** One-based, as stored on the playlist item. */
  songNr: number | null | undefined;
  label: string;
  /** The notice the engine choice itself calls for, when it was overridden. */
  selectionNotice: EngineFallbackNotice | null;
  /** Demo Mode or no device: neither can supply the C64's ROMs. */
  noMachineForRoms: boolean;
  /** A C64 that can play the song is reachable: connected, not Demo Mode, not offline. */
  c64Usable: boolean;
  /**
   * The playlist or station is moving on by itself, or the listener pressed Next or Previous: no song
   * was chosen, so one that needs the C64's ROMs is passed over. False when the listener picked this song.
   */
  passOver: boolean;
  /** Asks the listener about a chosen song. Absent, nothing can be asked and the song is not played. */
  ask?: RomDependencyAsk;
  notify: (notice: EngineFallbackNotice) => void;
  /** Stops what is sounding, so declining does not leave the previous tune playing under a stopped screen. */
  stopPhone: () => void;
}

/**
 * Resolves true when the song is to play on this device, false when the C64 takes it. Throws
 * {@link RomDependentSongSkipped} when a playlist moving on passes over a song that needs the C64's
 * ROMs, and {@link RomDependentSongDeclined} when the listener says no to playing it here.
 */
export const resolveLocalRoute = async (input: LocalRouteInput): Promise<boolean> => {
  const { notify } = input;
  let routeToLocal = false;
  // `skip`, `ask` and `phone` are carried out below, outside the try whose catch would swallow a skip.
  let later: "skip" | "ask" | "phone" | null = null;
  try {
    const sidBytes = new Uint8Array(await input.file.arrayBuffer());
    const romsReady = hasCompleteRomSet();
    const romRequired = detectRomRequired(sidBytes);
    let different = false;
    let unverified = false;
    // A declared requirement that the missing images cannot satisfy already goes to the C64.
    if (!romRequired || romsReady) {
      await probeSidRenderers();
      const verdict = await assessRomDependency({ sidBytes, songNr: input.songNr, engine: playbackSidEmulation() });
      unverified = verdict.kind === "unknown";
      different = verdict.kind === "incompatible";
      if (verdict.kind === "incompatible") {
        const outcome = decideRomListedPlayback({
          c64Usable: input.c64Usable,
          skipEnabled: loadSkipRomDependentSongs(),
          autoAdvance: input.passOver,
        });
        addLog("info", "Song needs the C64 ROMs on this device", {
          service: "rom-dependency",
          item: input.label,
          songNr: input.songNr ?? null,
          lane: verdict.lane,
          outcome,
        });
        if (outcome === "c64") {
          // The C64 is there, so the ROMs are worth reading from it for the songs that follow.
          if (!romsReady && loadLocalEngineAutoRoms()) void ensureSystemRoms();
        } else {
          later = outcome;
        }
      }
    }
    const decision = romFallbackDecision(romRequired, romsReady, different);
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
    if (later === null && decision.route === "local" && unverified && !input.passOver) {
      notify("rom-list-unverified");
    }
  } catch (error) {
    addErrorLog("Local engine could not read the SID; using the C64", {
      error: (error as Error).message,
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
  if (later === "ask" && ((await input.ask?.()) ?? "cancel") === "cancel") {
    input.stopPhone();
    const declined = new RomDependentSongDeclined(input.label);
    markPlaybackErrorReported(declined);
    throw declined;
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
      passedOver.add(index);
    }
  }
  return false;
};

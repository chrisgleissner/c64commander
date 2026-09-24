/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getC64API, getC64APIConfigSnapshot } from "@/lib/c64api";
import { isAbortLikeError } from "@/lib/c64api/requestRuntime";
import { getConnectionSnapshot, subscribeConnection } from "@/lib/connection/connectionManager";
import { addLog } from "@/lib/logging";
import { isRemotePlaybackActive, markRemotePlaybackStopped } from "./activePlaybackSession";
import { getSharedLocalSidPlaybackController, LocalSidPlaybackController } from "./localSidPlaybackController";
import { isTuneStillPlayingOnC64 } from "./tuneStillPlayingOnC64";

/**
 * A SID playing on the C64 carries on on the phone when the device goes out of reach, and the C64 is reset when
 * it is back. An open Play page takes the tune over itself, so its transport and clock follow; with no Play page
 * open the phone plays the tune here, and the page adopts it when it opens.
 */

/** A SID the C64 is playing, described well enough to play it here without the Play page. */
export type RemoteTune = {
  itemId: string;
  label: string;
  tuneIndex: number;
  renderKey: string;
  /** Wall clock time at which the tune started on the C64. */
  startedAt: number;
  durationMs: number;
  readBytes: () => Promise<ArrayBuffer | null>;
};

type HandedOver = { startedAt: number; host: string; readBytes?: RemoteTune["readBytes"] };

const RESET_TIMEOUT_MS = 3000;
const RESET_SETTLE_MS = 1000;
const RESET_ATTEMPTS = 3;
const HANDED_OVER_CLOCK_TOLERANCE_MS = 3000;
const TUNE_END_GRACE_MS = 1000;

let remoteTune: RemoteTune | null = null;
let pageCarriesOn: (() => void) | null = null;
let handedOver: HandedOver | null = null;
let tuneForPage: string | null = null;

export const rememberRemoteTune = (tune: RemoteTune | null) => {
  remoteTune = tune;
};

/** Registered by an open Play page, which takes the tune over itself. */
export const registerPageHandover = (carryOn: () => void) => {
  pageCarriesOn = carryOn;
  return () => {
    if (pageCarriesOn === carryOn) pageCarriesOn = null;
  };
};

export const noteTuneHandedOver = (startedAt: number) => {
  const tune =
    remoteTune && Math.abs(remoteTune.startedAt - startedAt) < HANDED_OVER_CLOCK_TOLERANCE_MS ? remoteTune : null;
  handedOver = { startedAt, host: getC64APIConfigSnapshot().deviceHost, readBytes: tune?.readBytes };
};

// A restored page clock can be a moment off the one the tune was taken over with.
export const wasTuneHandedOver = (startedAt: number) =>
  handedOver !== null && Math.abs(handedOver.startedAt - startedAt) < HANDED_OVER_CLOCK_TOLERANCE_MS;

/** The playlist item taken over while no Play page was open, handed once to the page that opens next. */
export const takeTuneHandedOverWithoutPage = (): string | null => {
  const itemId = tuneForPage;
  tuneForPage = null;
  return itemId;
};

export const resetRemoteTuneHandoverForTests = () => {
  remoteTune = null;
  pageCarriesOn = null;
  handedOver = null;
  tuneForPage = null;
};

const logHandoverFailure = (message: string, error: unknown, context: Record<string, unknown> = {}) =>
  addLog("warn", message, {
    ...context,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

const readTuneBytes = (readBytes: RemoteTune["readBytes"], context: Record<string, unknown>) =>
  readBytes().catch((error: unknown) => {
    logHandoverFailure("Playback: could not read the tune's bytes to carry it on this phone", error, context);
    return null;
  });

const carryOnWithoutPage = async () => {
  const tune = remoteTune;
  if (!tune || !isRemotePlaybackActive() || handedOver?.startedAt === tune.startedAt) return;
  if (!LocalSidPlaybackController.isSupported() || Date.now() - tune.startedAt >= tune.durationMs) return;
  const bytes = await readTuneBytes(tune.readBytes, { item: tune.label });
  if (!bytes) {
    addLog("info", "Playback: the C64 is out of reach and this tune cannot carry on here", { item: tune.label });
    return;
  }
  handedOver = { startedAt: tune.startedAt, host: getC64APIConfigSnapshot().deviceHost, readBytes: tune.readBytes };
  tuneForPage = tune.itemId;
  addLog("info", "Playback: the C64 is out of reach; carrying on with the tune on this phone", {
    item: tune.label,
    positionSeconds: Math.round((Date.now() - tune.startedAt) / 100) / 10,
    playPageOpen: false,
  });
  const controller = getSharedLocalSidPlaybackController();
  const muted = controller.muted();
  // Silent until the seek lands, or the opening of the tune would be heard first.
  controller.setMuted(true);
  try {
    await controller.play({ name: tune.label, arrayBuffer: async () => bytes }, tune.tuneIndex, undefined, {
      prerenderKey: tune.renderKey,
      durationSeconds: tune.durationMs / 1000,
    });
    await controller.seekTo((Date.now() - tune.startedAt) / 1000);
    // Without a Play page nothing moves the playlist on, so the tune is stopped at its end unless a page took it.
    // Timed rather than on the engine's end: that fires once the audio is written, which a deep native buffer is
    // well before it is heard.
    setTimeout(
      () => {
        if (tuneForPage !== tune.itemId) return;
        tuneForPage = null;
        controller.stop();
      },
      tune.startedAt + tune.durationMs - Date.now() + TUNE_END_GRACE_MS,
    );
  } catch (error) {
    addLog("warn", "Playback: could not carry on with the tune on this phone", {
      item: tune.label,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    controller.setMuted(muted);
  }
};

// Back home the C64 is still looping the tune it was playing; the phone finishes it, the next track goes back.
// A check that cannot be made leaves the reset to go ahead, as it did before the check existed.
const stillPlaysTuneLeft = async (tuneLeft: HandedOver) => {
  const bytes = tuneLeft.readBytes ? await readTuneBytes(tuneLeft.readBytes, { deviceHost: tuneLeft.host }) : null;
  if (!bytes) return null;
  return isTuneStillPlayingOnC64(getC64API(), bytes).catch((error) => {
    if (isAbortLikeError(error)) throw error;
    logHandoverFailure("Playback: could not check whether the C64 still plays the tune; resetting it", error, {
      deviceHost: tuneLeft.host,
    });
    return null;
  });
};

const silenceTuneLeftOnDevice = async () => {
  const tuneLeft = handedOver;
  if (!tuneLeft) return;
  handedOver = null;
  // Reconnecting re-routes the API a moment after the state changes, which aborts a request sent at once.
  for (let attempt = 1; attempt <= RESET_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, RESET_SETTLE_MS));
    const stillThere = getConnectionSnapshot().state === "REAL_CONNECTED" && isRemotePlaybackActive();
    if (!stillThere || getC64APIConfigSnapshot().deviceHost !== tuneLeft.host) return;
    try {
      // Somebody at home may have reset the C64 or used it for something else meanwhile; a reset would end that.
      if ((await stillPlaysTuneLeft(tuneLeft)) === false) {
        markRemotePlaybackStopped();
        addLog("info", "Playback: left the C64 as it is; it no longer plays the tune this phone carried on");
        return;
      }
      await Promise.race([
        getC64API().machineReset(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Reset timed out")), RESET_TIMEOUT_MS)),
      ]);
      markRemotePlaybackStopped();
      addLog("info", "Playback: stopped the tune left playing on the C64 while this phone was away");
      return;
    } catch (error) {
      if (attempt < RESET_ATTEMPTS && isAbortLikeError(error)) continue;
      addLog("warn", "Playback: could not stop the tune left playing on the C64", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }
};

export const installRemoteTuneHandover = () => {
  let previous = getConnectionSnapshot().state;
  const unsubscribe = subscribeConnection(() => {
    const { state } = getConnectionSnapshot();
    const was = previous;
    previous = state;
    if (state === was) return;
    if (state === "OFFLINE_NO_DEMO") {
      if (pageCarriesOn) pageCarriesOn();
      else void carryOnWithoutPage();
    }
    if (state === "REAL_CONNECTED") void silenceTuneLeftOnDevice();
  });
  return () => {
    unsubscribe();
  };
};

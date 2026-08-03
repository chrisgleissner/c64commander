/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { featureFlagManager } from "@/lib/config/featureFlags";
import { loadMirrorC64Audio, loadMirrorC64Video } from "@/lib/config/appSettings";
import { avMirrorSession, type AvMirrorSession } from "@/lib/streams/avMirrorSession";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { variant } from "@/generated/variant";
import { addLog } from "@/lib/logging";

/**
 * Which feeds this particular launch started. Closing the sheet stops exactly
 * these, so a user who already had Listen on keeps listening afterwards while one
 * who started from nothing is not left with the radio draining the battery behind
 * a closed sheet.
 */
export interface GameModeStartResult {
  startedVideo: boolean;
  startedAudio: boolean;
}

const GAME_MODE_REQUEST_EVENT = "c64u-game-mode-request";

const flagEnabled = (id: "live_view_enabled" | "audio_mirror_enabled" | "video_mirror_enabled"): boolean =>
  Boolean(featureFlagManager.getSnapshot().flags[id]);

/**
 * Starts the picture and the sound the user last asked for, then asks whichever
 * Remote Input sheet is mounted to open in the playing state.
 *
 * Both stream calls are idempotent, so a feed already running is left as it is
 * and is reported as not started by this launch.
 */
export const startGameMode = async (opts?: { session?: AvMirrorSession }): Promise<GameModeStartResult> => {
  const session = opts?.session ?? avMirrorSession;
  const liveView = flagEnabled("live_view_enabled");
  const wantsVideo = liveView && flagEnabled("video_mirror_enabled") && loadMirrorC64Video();
  const wantsAudio = liveView && flagEnabled("audio_mirror_enabled") && loadMirrorC64Audio();

  const startedVideo = wantsVideo && !session.videoLive;
  const startedAudio = wantsAudio && !session.audioLive;

  // Both facts are known before either stream call, so the sheet is asked to open
  // synchronously rather than after a network round trip — pressing Game Mode has
  // to look like it worked at once. A start that then fails leaves the record
  // claiming a stream that never ran, which costs only an idempotent stop later.
  const started: GameModeStartResult = { startedVideo, startedAudio };
  requestGameMode(started);

  // Every call site fires this and forgets it, because the sheet has already been asked to
  // open and nothing downstream waits on the streams. A rejected start must therefore be
  // logged and swallowed here; letting it escape would surface as an unhandled rejection.
  // The record still claims the stream, which costs only an idempotent stop later.
  const start = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error: unknown) {
      addLog("warn", `Game Mode: failed to start the ${name} stream`, {
        service: "streams",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  };

  if (startedVideo) await start("video", () => session.startVideo());
  if (startedAudio) await start("audio", () => session.startAudio());
  return started;
};

const NOTHING_STARTED: GameModeStartResult = { startedVideo: false, startedAudio: false };

/** How long an unclaimed request waits for a sheet to mount before it is stale. */
const PENDING_REQUEST_TTL_MS = 5_000;

let pendingRequest: { epoch: number; started: GameModeStartResult; atMs: number } | null = null;
let requestEpoch = 0;

/**
 * Take the outstanding request, if there is one and it is still fresh.
 *
 * A request is claimed exactly once. That is what keeps two mounted sheets from
 * both opening, and what lets a request survive the gap between the `0` key being
 * pressed on a page that hosts no sheet and the page that does finishing its mount.
 */
const takePendingGameModeRequest = (): GameModeStartResult | null => {
  if (pendingRequest === null) return null;
  const claimed = pendingRequest;
  pendingRequest = null;
  return Date.now() - claimed.atMs > PENDING_REQUEST_TTL_MS ? null : claimed.started;
};

/**
 * Ask a Remote Input sheet to open in Game Mode, telling it which feeds this launch
 * started so closing the sheet can stop exactly those.
 *
 * A module-level requester rather than a prop: Home and Play each own their own
 * sheet, and this is how the `0` shortcut reaches whichever one is mounted.
 */
export const requestGameMode = (started: GameModeStartResult = NOTHING_STARTED): void => {
  if (typeof window === "undefined") return;
  requestEpoch += 1;
  pendingRequest = { epoch: requestEpoch, started, atMs: Date.now() };
  window.dispatchEvent(new CustomEvent(GAME_MODE_REQUEST_EVENT));
};

/**
 * Subscribe a Remote Input sheet to Game Mode requests, claiming any request that
 * is already outstanding when it mounts. Returns an unsubscribe.
 */
export const subscribeGameModeRequest = (handler: (started: GameModeStartResult) => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const claim = () => {
    const started = takePendingGameModeRequest();
    if (started !== null) handler(started);
  };
  claim();
  window.addEventListener(GAME_MODE_REQUEST_EVENT, claim);
  return () => window.removeEventListener(GAME_MODE_REQUEST_EVENT, claim);
};

/** Test-only: drop an unclaimed request so it cannot leak into the next case. */
export const resetPendingGameModeRequest = (): void => {
  pendingRequest = null;
};

/** Pages that mount a Remote Input sheet, and can therefore answer a request in place. */
export const GAME_MODE_HOST_PATHS: ReadonlySet<string> = new Set(["/", "/play"]);

const GAME_MODE_ON_LAUNCH_KEY = "c64u_game_mode_on_launch";

export const DEFAULT_GAME_MODE_ON_LAUNCH = Boolean(variant.runtime.defaultGameModeOnLaunch);

export const loadGameModeOnLaunch = (): boolean => {
  if (typeof localStorage === "undefined") return DEFAULT_GAME_MODE_ON_LAUNCH;
  const raw = localStorage.getItem(GAME_MODE_ON_LAUNCH_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return DEFAULT_GAME_MODE_ON_LAUNCH;
};

export const saveGameModeOnLaunch = (enabled: boolean): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GAME_MODE_ON_LAUNCH_KEY, enabled ? "1" : "0");
};

export type PlaybackLaunchOrigin = "user" | "auto";

export interface AutoEnterGameModeInput {
  readonly category: PlayFileCategory;
  /** `auto` is a playlist moving on by itself, which must never open a sheet. */
  readonly origin: PlaybackLaunchOrigin;
  readonly sheetAlreadyOpen: boolean;
  readonly enabled: boolean;
}

/**
 * Whether a successful launch should go straight into Game Mode.
 *
 * Every condition is here rather than spread through the caller, because a rule of
 * four conditions is exactly where a later change silently drops one — and the one
 * that gets dropped turns a queue of programs into a sheet that reopens at every
 * track.
 */
export const shouldEnterGameModeOnLaunch = ({
  category,
  origin,
  sheetAlreadyOpen,
  enabled,
}: AutoEnterGameModeInput): boolean => {
  if (!enabled) return false;
  if (origin !== "user") return false;
  if (sheetAlreadyOpen) return false;
  return category === "prg" || category === "crt" || category === "disk";
};

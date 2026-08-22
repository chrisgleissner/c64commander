/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { addLog } from "@/lib/logging";
import { subscribeGameModeRequest, type GameModeStartResult } from "@/lib/remoteInput/gameModeLaunch";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import type { RemoteInputOutputMode } from "@/hooks/useRemoteInputSession";

export interface RemoteInputGameModeOptions {
  open: boolean;
  joystickAvailable: boolean;
  /** Whether `joystickAvailable` reflects an actual probe rather than the conservative default. */
  tierResolved: boolean;
  outputMode: RemoteInputOutputMode;
  setOutputMode: (mode: RemoteInputOutputMode) => void;
  /** Ask the host page to open the sheet, for a request that arrives while it is closed. */
  requestSheetOpen: () => void;
  session: AvMirrorSession;
}

export interface RemoteInputGameModeState {
  immersive: boolean;
  exitGameMode: () => void;
  /** Stops only the feeds this Game Mode launch started. Call when the sheet closes. */
  releaseLaunchedStreams: () => void;
}

const NOTHING_STARTED: GameModeStartResult = { startedVideo: false, startedAudio: false };

/**
 * Game Mode's launch, exit and stream ownership for the Remote Input sheet.
 *
 * The stream rule is deliberately narrow (spec §3.3): a user who already had
 * Listen on keeps listening after closing the sheet, while a user who started
 * from nothing is not left with the radio and video draining the battery behind a
 * closed sheet. Exiting Game Mode without closing stops nothing at all — they are
 * still on the surface that shows the streams.
 */
export const useRemoteInputGameMode = ({
  open,
  joystickAvailable,
  tierResolved,
  outputMode,
  setOutputMode,
  requestSheetOpen,
  session,
}: RemoteInputGameModeOptions): RemoteInputGameModeState => {
  const [immersive, setImmersive] = useState(false);
  const launchedStreamsRef = useRef<GameModeStartResult>(NOTHING_STARTED);

  const setOutputModeRef = useRef(setOutputMode);
  setOutputModeRef.current = setOutputMode;
  const requestSheetOpenRef = useRef(requestSheetOpen);
  requestSheetOpenRef.current = requestSheetOpen;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(
    () =>
      subscribeGameModeRequest((started) => {
        // Accumulate rather than replace: a second launch that found the streams
        // already running must not erase the record of the first one starting them.
        launchedStreamsRef.current = {
          startedVideo: launchedStreamsRef.current.startedVideo || started.startedVideo,
          startedAudio: launchedStreamsRef.current.startedAudio || started.startedAudio,
        };
        if (!openRef.current) requestSheetOpenRef.current();
        setOutputModeRef.current("joystick");
        setImmersive(true);
      }),
    [],
  );

  // Game Mode is joystick-only; drop out of it if the joystick relay becomes
  // unavailable (tier downgrade) so the user is never stranded in a stripped
  // layout that cannot do anything.
  //
  // Gated on the sheet being open with a RESOLVED tier, not merely on
  // `joystickAvailable`: while the sheet is closed the tier reads as the
  // conservative kernal-fallback default, which would cancel a launch request the
  // instant it arrived — the sheet would open, but never in Game Mode.
  useEffect(() => {
    if (open && tierResolved && !joystickAvailable && immersive) setImmersive(false);
  }, [open, tierResolved, joystickAvailable, immersive]);

  useEffect(() => {
    if (outputMode !== "joystick" && immersive) setImmersive(false);
  }, [outputMode, immersive]);

  const releaseLaunchedStreams = useCallback(() => {
    const started = launchedStreamsRef.current;
    launchedStreamsRef.current = NOTHING_STARTED;
    setImmersive(false);
    const stop = (name: string, run: () => Promise<void>) => {
      run().catch((error: unknown) => {
        // A failed stop leaves the device streaming to a closed sheet, which is the
        // exact battery and bandwidth cost this rule exists to avoid.
        addLog("warn", `Game Mode: failed to stop the ${name} stream it started`, {
          service: "streams",
          error: error instanceof Error ? error.message : String(error),
          // A stream that will not stop is hard to reproduce on a desk, so the diagnostics
          // report has to carry where it failed, not just what it said.
          stack: error instanceof Error ? error.stack : undefined,
        });
      });
    };
    if (started.startedVideo) stop("video", () => session.stopVideo());
    if (started.startedAudio) stop("audio", () => session.stopAudio());
  }, [session]);

  const exitGameMode = useCallback(() => setImmersive(false), []);

  return { immersive, exitGameMode, releaseLaunchedStreams };
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { getSharedLocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import type { PendingSeekState } from "@/lib/playback/pendingSeekStatus";

/** Polled rather than pushed: the render head moves a few times a second at most. */
export const IDLE_POLL_MS = 500;
/** While a seek waits, so the bar shows the landing within a frame or two of the audio resuming. */
export const AWAITING_POLL_MS = 100;

const samePendingSeek = (a: PendingSeekState | null, b: PendingSeekState | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.targetSeconds === b.targetSeconds &&
    a.generation === b.generation &&
    a.trackInstanceId === b.trackInstanceId);

/**
 * How far the on-device engine has rendered the tune, and the seek it is waiting for, if any. `onLanded` runs as soon
 * as a waited-for seek is over, so the elapsed time and the solid bar move to the target at once, not on the next tick.
 */
export const useLocalPendingSeek = (localEngineActive: boolean, trackKey: unknown, onLanded: () => void) => {
  const [renderedSeconds, setRenderedSeconds] = useState<number | null>(null);
  const [pendingSeekState, setPendingSeekState] = useState<PendingSeekState | null>(null);
  const awaiting = pendingSeekState !== null;
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

  useEffect(() => {
    if (!localEngineActive) {
      setRenderedSeconds(null);
      setPendingSeekState(null);
      return;
    }
    (globalThis as Record<string, unknown>).__localEngineDebug = () =>
      getSharedLocalSidPlaybackController().debugState();
    const read = () => {
      const controller = getSharedLocalSidPlaybackController();
      setRenderedSeconds(controller.renderedSeconds());
      const pending = controller.pendingSeek();
      setPendingSeekState((previous) => (samePendingSeek(previous, pending) ? previous : pending));
    };
    read();
    const timer = window.setInterval(read, awaiting ? AWAITING_POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [localEngineActive, trackKey, awaiting]);

  const wasAwaitingRef = useRef(false);
  useEffect(() => {
    if (wasAwaitingRef.current && !awaiting) onLandedRef.current();
    wasAwaitingRef.current = awaiting;
  }, [awaiting]);

  return { renderedSeconds, pendingSeekState };
};

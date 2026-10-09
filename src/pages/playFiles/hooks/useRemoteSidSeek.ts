/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getC64API, type DeviceInfo } from "@/lib/c64api";
import { probeMachineInputCapability } from "@/lib/deviceCapabilities";
import { addErrorLog, addLog } from "@/lib/logging";
import { getRememberedUltimateSidBlob, tryFetchUltimateSidBlob } from "@/lib/playback/playbackRouter";
import {
  cancelRemoteSidSeek,
  createRemoteSeekApi,
  setActiveRemoteSidSeek,
} from "@/lib/playback/remoteSeek/activeRemoteSidSeek";
import { rewindOffsetSeconds } from "@/lib/playback/remoteSeek/remoteSeekPlan";
import {
  probeRemoteTuneSeek,
  remoteSeekHeaderBlocker,
  RemoteSidSeekController,
} from "@/lib/playback/remoteSeek/remoteSidSeekController";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import { parseSidHeaderMetadata, type SidHeaderMetadata } from "@/lib/sid/sidUtils";
import type { PlaylistItem } from "../types";

/** The seek handlers the transport card takes, shared by the on-device engine and the C64. */
export type PlaybackSeekHandlers = {
  onSeek?: (deltaSeconds: number) => void;
  onScrubStart?: () => void;
  onScrubStep?: (deltaSeconds: number) => void;
  onScrubEnd?: () => void;
  onSeekToFraction?: (fraction: number) => void;
};

type Options = {
  item: PlaylistItem | undefined;
  /** The C64 is playing this SID itself, unpaused. */
  active: boolean;
  trackInstanceId: number;
  deviceInfo: DeviceInfo | null | undefined;
  elapsedMs: number;
  durationMs: number | undefined;
  rebasePlaybackPosition: (positionMs: number) => void;
};

/** The player's screen appears a moment after the tune starts; probing earlier only finds the old one. */
const PROBE_DELAY_MS = 800;
/** A drag lands this long after the finger stops, the same settle the on-device engine uses. */
const DRAG_SETTLE_MS = 220;
const REWIND_STEP_INTERVAL_MS = 1000;

/** One hold of Previous or Next. It lives until release, so the card's repeat ticks never start a second one. */
type Hold = { direction: "forward" | "rewind"; fromSeconds: number; rewindSteps: number; ended: boolean };

const errorDetails = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
});

const readHeader = async (item: PlaylistItem): Promise<SidHeaderMetadata | null> => {
  const blob =
    item.request.file ??
    (item.request.source === "ultimate"
      ? (getRememberedUltimateSidBlob(item.request.path, item.request.origin) ??
        (await tryFetchUltimateSidBlob(item.request.path, item.request.origin)))
      : null);
  if (!blob) return null;
  return parseSidHeaderMetadata(new Uint8Array(await blob.arrayBuffer()));
};

const machineInputAvailable = async (deviceInfo: DeviceInfo) => {
  const result = await probeMachineInputCapability({
    api: getC64API(),
    deviceId: getSelectedSavedDevice()?.id ?? null,
    firmwareVersion: deviceInfo.firmware_version ?? null,
    coreVersion: deviceInfo.core_version ?? null,
  });
  return result.status === "available";
};

/**
 * Fast forward, rewind and jumps for a SID the C64 plays itself, behind the same gestures the
 * on-device engine uses: hold Next to fast forward (faster each second), hold Previous to move the
 * target back 10, 20, 40, then 80 seconds a second and jump there on release, and drag the bar.
 *
 * Returns no handlers until the tune is known to support it: a PSID with a play routine, on a
 * machine that takes key input, showing the Ultimate SID player. Until then Previous and Next stay
 * plain track controls, exactly as before.
 */
export const useRemoteSidSeek = ({
  item,
  active,
  trackInstanceId,
  deviceInfo,
  elapsedMs,
  durationMs,
  rebasePlaybackPosition,
}: Options): { handlers: PlaybackSeekHandlers | null; targetMs: number | null } => {
  const [controller, setController] = useState<RemoteSidSeekController | null>(null);
  const [targetMs, setTargetMs] = useState<number | null>(null);
  const controllerRef = useRef<RemoteSidSeekController | null>(null);
  const holdRef = useRef<Hold | null>(null);
  const rewindTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ elapsedMs, durationMs, rebasePlaybackPosition });
  live.current = { elapsedMs, durationMs, rebasePlaybackPosition };

  const itemId = item?.id ?? null;
  const songNr = item?.request.songNr ?? null;
  const coreVersion = deviceInfo?.core_version ?? null;

  useEffect(() => {
    if (!active || !item || item.category !== "sid" || !deviceInfo || !coreVersion) return;
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const header = await readHeader(item);
          const blocker = remoteSeekHeaderBlocker(header);
          if (blocker || !header) {
            addLog("debug", "Remote seek unavailable for this tune", { item: item.label, reason: blocker });
            return;
          }
          if (!current || !(await machineInputAvailable(deviceInfo))) return;
          const api = createRemoteSeekApi();
          const profile = await probeRemoteTuneSeek(api, header, songNr ?? header.startSong, () => current);
          if (!current) return;
          if (!profile) {
            addLog("debug", "Remote seek unavailable: the SID player screen was not found", { item: item.label });
            return;
          }
          const created = new RemoteSidSeekController(api, profile);
          controllerRef.current = created;
          setActiveRemoteSidSeek(created);
          setController(created);
          addLog("debug", "Remote seek available", { item: item.label, profile });
        } catch (error) {
          addLog("warn", "Remote seek probe failed", { item: item.label, ...errorDetails(error) });
        }
      })();
    }, PROBE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
      const owned = controllerRef.current;
      controllerRef.current = null;
      holdRef.current = null;
      if (rewindTimerRef.current !== null) clearInterval(rewindTimerRef.current);
      if (dragTimerRef.current !== null) clearTimeout(dragTimerRef.current);
      rewindTimerRef.current = dragTimerRef.current = null;
      setController(null);
      setTargetMs(null);
      if (owned) {
        setActiveRemoteSidSeek(null);
        void owned.cancel("tune or route changed");
      }
    };
    // `item` is read through its id: a new object for the same tune must not restart the probe.
  }, [active, itemId, songNr, trackInstanceId, coreVersion]);

  // A hidden page stops running timers within a minute; a seek must not be left holding the key.
  useEffect(() => {
    if (!controller) return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      holdRef.current = null;
      setTargetMs(null);
      void cancelRemoteSidSeek("app hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [controller]);

  const clampMs = (ms: number) => Math.max(0, Math.min(live.current.durationMs ?? Number.MAX_SAFE_INTEGER, ms));

  const land = useCallback((positionSeconds: number | null) => {
    if (positionSeconds !== null) live.current.rebasePlaybackPosition(clampMs(positionSeconds * 1000));
    setTargetMs(null);
  }, []);

  const jump = useCallback(
    async (fromSeconds: number, toSeconds: number) => {
      const owned = controllerRef.current;
      if (!owned) return;
      setTargetMs(clampMs(toSeconds * 1000));
      land(await owned.jumpTo(fromSeconds, toSeconds));
    },
    [land],
  );

  const onScrubStart = useCallback(() => {
    holdRef.current = null;
  }, []);

  const onScrubStep = useCallback(
    (deltaSeconds: number) => {
      const owned = controllerRef.current;
      if (!owned || holdRef.current) return;
      const fromSeconds = live.current.elapsedMs / 1000;
      if (deltaSeconds > 0) {
        const hold: Hold = { direction: "forward", fromSeconds, rewindSteps: 0, ended: false };
        holdRef.current = hold;
        setTargetMs(clampMs(fromSeconds * 1000));
        const durationSeconds = (live.current.durationMs ?? Number.POSITIVE_INFINITY) / 1000;
        owned
          .beginFastForward(fromSeconds, (positionSeconds) => {
            setTargetMs(clampMs(positionSeconds * 1000));
            // Past the end there is nothing left to hear; land, and let auto-advance take the next tune.
            if (positionSeconds >= durationSeconds && !hold.ended) {
              hold.ended = true;
              void owned.endFastForward("reached the end").then(land);
            }
          })
          .catch((error) => {
            addErrorLog("Remote fast forward could not start", errorDetails(error));
            hold.ended = true;
            setTargetMs(null);
          });
        return;
      }
      if (!owned.canRewind) return;
      const hold: Hold = { direction: "rewind", fromSeconds, rewindSteps: 1, ended: false };
      holdRef.current = hold;
      const showTarget = () => setTargetMs(clampMs((fromSeconds - rewindOffsetSeconds(hold.rewindSteps)) * 1000));
      showTarget();
      rewindTimerRef.current = setInterval(() => {
        hold.rewindSteps += 1;
        showTarget();
      }, REWIND_STEP_INTERVAL_MS);
    },
    [land],
  );

  const onScrubEnd = useCallback(() => {
    const owned = controllerRef.current;
    const hold = holdRef.current;
    holdRef.current = null;
    if (rewindTimerRef.current !== null) clearInterval(rewindTimerRef.current);
    rewindTimerRef.current = null;
    if (!owned || !hold || hold.ended) return;
    if (hold.direction === "forward") {
      void owned.endFastForward().then(land);
      return;
    }
    const target = Math.max(0, hold.fromSeconds - rewindOffsetSeconds(hold.rewindSteps));
    void jump(hold.fromSeconds, target);
  }, [jump, land]);

  const onSeekToFraction = useCallback(
    (fraction: number) => {
      const duration = live.current.durationMs;
      if (!controllerRef.current || !duration) return;
      const targetSeconds = (Math.min(1, Math.max(0, fraction)) * duration) / 1000;
      setTargetMs(targetSeconds * 1000);
      if (dragTimerRef.current !== null) clearTimeout(dragTimerRef.current);
      // Only where the finger comes to rest is a jump: each one may restart and fast forward the tune.
      dragTimerRef.current = setTimeout(() => {
        dragTimerRef.current = null;
        void jump(live.current.elapsedMs / 1000, targetSeconds);
      }, DRAG_SETTLE_MS);
    },
    [jump],
  );

  const handlers =
    controller && active
      ? {
          // The card only offers a hold when `onSeek` is set; the gesture itself runs through the scrub handlers.
          onSeek: () => undefined,
          onScrubStart,
          onScrubStep,
          onScrubEnd,
          onSeekToFraction: durationMs ? onSeekToFraction : undefined,
        }
      : null;
  return { handlers, targetMs };
};

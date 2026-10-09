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
import { withCartridgeParked } from "@/lib/playback/launchSafety";
import { getRememberedUltimateSidBlob, tryFetchUltimateSidBlob } from "@/lib/playback/playbackRouter";
import {
  cancelRemoteSidSeek,
  createRemoteSeekApi,
  setActiveRemoteSidSeek,
  setRemoteSidSeekGesture,
} from "@/lib/playback/remoteSeek/activeRemoteSidSeek";
import { isRemoteSeekSuperseded, remoteSeekErrorDetails } from "@/lib/playback/remoteSeek/remoteSeekErrors";
import { rewindOffsetSeconds } from "@/lib/playback/remoteSeek/remoteSeekPlan";
import { RemoteSidSeekController, type RemoteSeekLanding } from "@/lib/playback/remoteSeek/remoteSidSeekController";
import { probeRemoteTuneSeek, remoteSeekHeaderBlocker } from "@/lib/playback/remoteSeek/remoteTuneSeekProbe";
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

/** The tune's bytes, from the playlist item or the Ultimate's file system, and its header. */
const readTune = async (item: PlaylistItem): Promise<{ blob: Blob; header: SidHeaderMetadata | null } | null> => {
  const blob =
    item.request.file ??
    (item.request.source === "ultimate"
      ? (getRememberedUltimateSidBlob(item.request.path, item.request.origin) ??
        (await tryFetchUltimateSidBlob(item.request.path, item.request.origin)))
      : null);
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob: new Blob([bytes]), header: parseSidHeaderMetadata(bytes) };
};

/**
 * Start the tune afresh, on a machine whose player cannot be restarted by key: the same bytes and
 * sub tune, with the cartridge parked as the Play page parks it for every SID it starts.
 */
const replayTune = (blob: Blob, songNr: number | undefined, filename: string) => async () => {
  const api = getC64API();
  await withCartridgeParked(api, () => api.playSidUpload(blob, songNr, undefined, { filename }));
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
  const jumpingRef = useRef(false);
  /** The latest target asked for while a jump ran; it starts from where that jump landed. */
  const queuedTargetRef = useRef<number | null>(null);
  /** Holds engaged on Previous and Next together; the gesture ends when the last one is released. */
  const holdsDownRef = useRef(0);
  /** The last landing, until the elapsed time the page reports has caught up with it. */
  const latestLandingRef = useRef<RemoteSeekLanding | null>(null);
  const live = useRef({ elapsedMs, durationMs, rebasePlaybackPosition });
  live.current = { elapsedMs, durationMs, rebasePlaybackPosition };

  const resetGestures = useCallback(() => {
    holdRef.current = null;
    holdsDownRef.current = 0;
    queuedTargetRef.current = null;
    latestLandingRef.current = null;
    if (rewindTimerRef.current !== null) clearInterval(rewindTimerRef.current);
    if (dragTimerRef.current !== null) clearTimeout(dragTimerRef.current);
    rewindTimerRef.current = dragTimerRef.current = null;
    setTargetMs(null);
  }, []);

  const itemId = item?.id ?? null;
  const songNr = item?.request.songNr ?? null;
  const deviceId = deviceInfo?.unique_id ?? null;

  useEffect(() => {
    if (!active || !item || item.category !== "sid" || !deviceInfo) return;
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const tune = await readTune(item);
          const header = tune?.header ?? null;
          const blocker = remoteSeekHeaderBlocker(header);
          if (blocker || !tune || !header) {
            addLog("debug", "Remote seek unavailable for this tune", { item: item.label, reason: blocker });
            return;
          }
          if (!current) return;
          const keyInput = await machineInputAvailable(deviceInfo);
          const api = createRemoteSeekApi();
          const profile = await probeRemoteTuneSeek(api, header, songNr ?? header.startSong, () => current, {
            keyInput,
          });
          if (!current) return;
          if (!profile) {
            addLog("debug", "Remote seek unavailable: no SID player clock or fast forward found", {
              item: item.label,
              keyInput,
            });
            return;
          }
          const replay = profile.restart === "replay" ? replayTune(tune.blob, songNr ?? undefined, item.path) : null;
          const created = new RemoteSidSeekController(api, profile, replay);
          controllerRef.current = created;
          setActiveRemoteSidSeek(created);
          setController(created);
          addLog("debug", "Remote seek available", { item: item.label, profile });
          void created.prepare().catch((error) =>
            addLog("warn", "Remote seek could not measure the tune's play-call rate", {
              item: item.label,
              ...remoteSeekErrorDetails(error),
            }),
          );
        } catch (error) {
          addLog("warn", "Remote seek probe failed", { item: item.label, ...remoteSeekErrorDetails(error) });
        }
      })();
    }, PROBE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
      const owned = controllerRef.current;
      controllerRef.current = null;
      resetGestures();
      setController(null);
      if (owned) {
        setActiveRemoteSidSeek(null);
        void owned.cancel("tune or route changed");
      }
    };
    // `item` is read through its id: a new object for the same tune must not restart the probe.
  }, [active, itemId, songNr, trackInstanceId, deviceId, resetGestures]);

  // While a gesture or a jump is under way the auto-advance deadline still counts the old position;
  // the Play page holds it off until the landing rebases it.
  useEffect(() => {
    setRemoteSidSeekGesture(targetMs !== null);
  }, [targetMs]);
  useEffect(() => () => setRemoteSidSeekGesture(false), []);

  // A hidden page stops running timers within a minute; a seek must not be left holding the key.
  useEffect(() => {
    if (!controller) return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      resetGestures();
      void cancelRemoteSidSeek("app hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [controller, resetGestures]);

  const clampMs = (ms: number) => Math.max(0, Math.min(live.current.durationMs ?? Number.MAX_SAFE_INTEGER, ms));

  const land = useCallback((landing: RemoteSeekLanding | null) => {
    if (landing) {
      latestLandingRef.current = landing;
      live.current.rebasePlaybackPosition(clampMs(landing.seconds * 1000 + Date.now() - landing.atMs));
    }
    setTargetMs(null);
  }, []);

  /** Where the tune is now: the last landing until the page's elapsed time has caught up with it. */
  const currentSeconds = useCallback((): number => {
    const landing = latestLandingRef.current;
    return landing ? landing.seconds + (Date.now() - landing.atMs) / 1000 : live.current.elapsedMs / 1000;
  }, []);

  const jump = useCallback(
    async (toSeconds: number) => {
      const owned = controllerRef.current;
      if (!owned) return;
      setTargetMs(clampMs(toSeconds * 1000));
      if (jumpingRef.current) {
        queuedTargetRef.current = toSeconds;
        return;
      }
      jumpingRef.current = true;
      try {
        let to = toSeconds;
        for (;;) {
          const landing = await owned.jumpTo(currentSeconds, to);
          if (controllerRef.current !== owned) return;
          if (landing) latestLandingRef.current = landing;
          const next = queuedTargetRef.current;
          queuedTargetRef.current = null;
          // A cancelled jump ends the chain: whatever cancelled it decides what happens next.
          if (next === null || !landing?.completed) {
            land(landing);
            return;
          }
          to = next;
        }
      } finally {
        jumpingRef.current = false;
      }
    },
    [currentSeconds, land],
  );

  const onScrubStart = useCallback(() => {
    holdsDownRef.current += 1;
  }, []);

  const onScrubStep = useCallback(
    (deltaSeconds: number) => {
      const owned = controllerRef.current;
      // A second button held at the same time joins the first gesture rather than starting another.
      if (!owned || holdRef.current || jumpingRef.current) return;
      const fromSeconds = currentSeconds();
      if (deltaSeconds > 0) {
        const hold: Hold = { direction: "forward", fromSeconds, rewindSteps: 0, ended: false };
        holdRef.current = hold;
        setTargetMs(clampMs(fromSeconds * 1000));
        const durationSeconds = (live.current.durationMs ?? Number.POSITIVE_INFINITY) / 1000;
        owned
          .beginFastForward(currentSeconds, (positionSeconds) => {
            setTargetMs(clampMs(positionSeconds * 1000));
            // Past the end there is nothing left to hear; land, and let auto-advance take the next tune.
            if (positionSeconds >= durationSeconds && !hold.ended) {
              hold.ended = true;
              void owned.endFastForward("reached the end").then(land);
            }
          })
          .catch((error) => {
            if (isRemoteSeekSuperseded(error)) {
              addLog("debug", "Remote fast forward did not start", remoteSeekErrorDetails(error));
            } else {
              addErrorLog("Remote fast forward could not start", remoteSeekErrorDetails(error));
            }
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
    [currentSeconds, land],
  );

  const onScrubEnd = useCallback(() => {
    holdsDownRef.current = Math.max(0, holdsDownRef.current - 1);
    if (holdsDownRef.current > 0) return;
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
    void jump(Math.max(0, hold.fromSeconds - rewindOffsetSeconds(hold.rewindSteps)));
  }, [jump, land]);

  const onSeekToFraction = useCallback(
    (fraction: number) => {
      const duration = live.current.durationMs;
      const owned = controllerRef.current;
      // The bar is left alone while Previous or Next is held: one gesture at a time.
      if (!owned || !duration || holdRef.current || owned.isFastForwarding) return;
      const targetSeconds = (Math.min(1, Math.max(0, fraction)) * duration) / 1000;
      setTargetMs(targetSeconds * 1000);
      if (dragTimerRef.current !== null) clearTimeout(dragTimerRef.current);
      // Only where the finger comes to rest is a jump: each one may restart and fast forward the tune.
      dragTimerRef.current = setTimeout(() => {
        dragTimerRef.current = null;
        void jump(targetSeconds);
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

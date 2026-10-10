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
  setRemoteSidSeekGestureReset,
} from "@/lib/playback/remoteSeek/activeRemoteSidSeek";
import { isRemoteSeekSuperseded, remoteSeekErrorDetails } from "@/lib/playback/remoteSeek/remoteSeekErrors";
import { rewindOffsetSeconds } from "@/lib/playback/remoteSeek/remoteSeekPlan";
import { RemoteSidSeekController, type RemoteSeekLanding } from "@/lib/playback/remoteSeek/remoteSidSeekController";
import { probeRemoteTuneSeek, remoteSeekHeaderBlocker } from "@/lib/playback/remoteSeek/remoteTuneSeekProbe";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import { toast } from "@/hooks/use-toast";
import {
  isPatchSeekUnsafe,
  markPatchSeekUnsafe,
  patchSeekFirmwareKey,
} from "@/lib/playback/remoteSeek/patchSeekSupport";
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
  /** The C64 is playing this SID itself, paused or not. */
  active: boolean;
  /** Paused: the gestures are off, and a seek under way is stopped, but the tune stays probed. */
  paused?: boolean;
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
const CLOCK_FOLLOW_INTERVAL_MS = 30_000;

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
 * Remote SID seek behind the on-device gestures: hold Next to fast forward (faster each second), hold Previous to move
 * the target back 10, 20, 40, then 80 seconds a second, jump on release, drag the bar. No handlers until the tune is a
 * PSID with a play routine, on a machine with key input, showing the Ultimate SID player.
 */
export const useRemoteSidSeek = ({
  item,
  active,
  paused = false,
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
  /** Where the running jump, or the one queued behind it, is heading. */
  const headingToRef = useRef<number | null>(null);
  /** The latest target asked for while a jump ran; it starts from where that jump landed. */
  const queuedTargetRef = useRef<number | null>(null);
  /** Holds engaged on Previous and Next together; the gesture ends when the last one is released. */
  const holdsDownRef = useRef(0);
  /** The last landing, until the elapsed time the page reports has caught up with it. */
  const latestLandingRef = useRef<RemoteSeekLanding | null>(null);
  /** Moves on with every gesture and landing, so a clock tick measured before one is not applied after it. */
  const seekEpochRef = useRef(0);
  /** A jump has been asked for: running, queued, or a tap on the bar still settling. */
  const jumpAwaited = useCallback(() => jumpingRef.current || dragTimerRef.current !== null, []);
  const live = useRef({ elapsedMs, durationMs, rebasePlaybackPosition });
  live.current = { elapsedMs, durationMs, rebasePlaybackPosition };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /** A probe that met a paused tune, whose clock stands still; it runs again on resume. */
  const probeDeferredRef = useRef(false);
  const pausesRef = useRef(0);
  const [probeRound, setProbeRound] = useState(0);

  const resetGestures = useCallback(() => {
    seekEpochRef.current += 1;
    holdRef.current = null;
    holdsDownRef.current = 0;
    queuedTargetRef.current = null;
    headingToRef.current = null;
    latestLandingRef.current = null;
    if (rewindTimerRef.current !== null) clearInterval(rewindTimerRef.current);
    if (dragTimerRef.current !== null) clearTimeout(dragTimerRef.current);
    rewindTimerRef.current = dragTimerRef.current = null;
    setTargetMs(null);
  }, []);

  const clampMs = (ms: number) => Math.max(0, Math.min(live.current.durationMs ?? Number.MAX_SAFE_INTEGER, ms));

  /**
   * Put the page's elapsed time on the C64's own second: where its clock just ticked, at the moment
   * it ticked. Skipped while a gesture or a jump owns the position.
   */
  const syncToClock = useCallback(async (owned: RemoteSidSeekController) => {
    const epoch = seekEpochRef.current;
    const tick = await owned.clockTick().catch((error) => {
      addLog("warn", "Remote seek could not read the SID player's clock to follow it", remoteSeekErrorDetails(error));
      return null;
    });
    // A tick from before a seek says where the tune was, not where it is.
    if (!tick || seekEpochRef.current !== epoch) return;
    if (controllerRef.current !== owned || holdRef.current || jumpingRef.current || owned.isBusy) return;
    latestLandingRef.current = { seconds: tick.clockSeconds, atMs: tick.tickAtMs, completed: true };
    live.current.rebasePlaybackPosition(clampMs(tick.clockSeconds * 1000 + Date.now() - tick.tickAtMs));
  }, []);

  const itemId = item?.id ?? null;
  const songNr = item?.request.songNr ?? null;
  const deviceId = deviceInfo?.unique_id ?? null;

  useEffect(() => {
    probeDeferredRef.current = false;
    if (!active || !item || item.category !== "sid" || !deviceInfo) return;
    let current = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (pausedRef.current) {
            probeDeferredRef.current = true;
            return;
          }
          const tune = await readTune(item);
          const header = tune?.header ?? null;
          const blocker = remoteSeekHeaderBlocker(header);
          if (blocker || !tune || !header) {
            addLog("debug", "Remote seek unavailable for this tune", { item: item.label, reason: blocker });
            return;
          }
          if (!current) return;
          const pausesBefore = pausesRef.current;
          const keyInput = await machineInputAvailable(deviceInfo);
          const firmwareKey = patchSeekFirmwareKey(deviceInfo);
          if (!keyInput && isPatchSeekUnsafe(firmwareKey)) {
            addLog("debug", "Remote seek off: this firmware's SID player is unsafe to patch", { item: item.label });
            return;
          }
          const api = createRemoteSeekApi();
          const profile = await probeRemoteTuneSeek(api, header, songNr ?? header.startSong, () => current, {
            keyInput,
          });
          if (!current) return;
          if (!profile && (pausedRef.current || pausesRef.current !== pausesBefore)) {
            if (pausedRef.current) probeDeferredRef.current = true;
            else setProbeRound((round) => round + 1);
            return;
          }
          if (!profile) {
            addLog("debug", "Remote seek unavailable: no SID player clock or fast forward found", {
              item: item.label,
              keyInput,
            });
            return;
          }
          const replay = profile.restart === "replay" ? replayTune(tune.blob, songNr ?? undefined, item.path) : null;
          const created = new RemoteSidSeekController(api, profile, replay);
          created.patchUnsafeListener = (health) => {
            if (markPatchSeekUnsafe(firmwareKey, health)) {
              toast({
                title: "Seeking not supported",
                description:
                  `Fast forward and rewind were tried with the SID player of firmware ${deviceInfo.firmware_version ?? "on this device"}, ` +
                  "which does not support them. The player was restored; Previous and Next skip tracks.",
              });
            }
            if (controllerRef.current !== created) return;
            controllerRef.current = null;
            setActiveRemoteSidSeek(null);
            resetGestures();
            setController(null);
          };
          // Show where a seek landed while its settings are still being given back, unless a jump
          // asked for since then still has to get there.
          created.landingListener = (landing, kind) => {
            // A controller let go of (another tune, another route) has nothing to say about this one.
            if (controllerRef.current !== created) return;
            seekEpochRef.current += 1;
            latestLandingRef.current = landing;
            if (kind === "fast forward" ? jumpAwaited() : queuedTargetRef.current !== null) return;
            live.current.rebasePlaybackPosition(clampMs(landing.seconds * 1000 + Date.now() - landing.atMs));
            setTargetMs(null);
          };
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
          void syncToClock(created);
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
  }, [active, itemId, songNr, trackInstanceId, deviceId, probeRound, resetGestures, syncToClock]);

  // The phone's timer and the C64's drift apart, and a resumed or rebased timeline can land between
  // two of the C64's seconds; following its clock now and then keeps them on the same second.
  useEffect(() => {
    if (!controller || paused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void syncToClock(controller);
    }, CLOCK_FOLLOW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [controller, paused, syncToClock]);

  // A pause stops whatever seek is under way and gives the device back; the probe stays, so the
  // gestures are back the moment the tune resumes, and the clock is followed again from there.
  useEffect(() => {
    if (paused) pausesRef.current += 1;
    const owned = controllerRef.current;
    if (!owned) {
      if (!paused && probeDeferredRef.current) setProbeRound((round) => round + 1);
      return;
    }
    if (paused) {
      resetGestures();
      void owned.cancel("paused");
    } else {
      void syncToClock(owned);
    }
  }, [paused, controller, resetGestures, syncToClock]);

  // While a gesture or a jump is under way the auto-advance deadline still counts the old position;
  // the Play page holds it off until the landing rebases it.
  useEffect(() => {
    setRemoteSidSeekGesture(targetMs !== null);
  }, [targetMs]);
  useEffect(() => () => setRemoteSidSeekGesture(false), []);
  useEffect(() => {
    setRemoteSidSeekGestureReset(resetGestures);
    return () => setRemoteSidSeekGestureReset(null);
  }, [resetGestures]);

  // A hidden page stops running timers within a minute; a seek must not be left holding the key.
  useEffect(() => {
    if (!controller) return;
    const onVisibility = () => {
      // Back in view, the tune may be elsewhere: a hold cancelled on hiding moved it while it lasted.
      if (document.visibilityState !== "hidden") {
        void syncToClock(controller);
        return;
      }
      resetGestures();
      void cancelRemoteSidSeek("app hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [controller, resetGestures, syncToClock]);

  const land = useCallback(
    (landing: RemoteSeekLanding | null) => {
      seekEpochRef.current += 1;
      if (landing) {
        latestLandingRef.current = landing;
        live.current.rebasePlaybackPosition(clampMs(landing.seconds * 1000 + Date.now() - landing.atMs));
        // A landing is good to the half second the clock rounds to; the clock's next tick is exact.
        const owned = controllerRef.current;
        if (owned) void syncToClock(owned);
      }
      setTargetMs(null);
    },
    [syncToClock],
  );
  /** A hold's landing must not clear the target of a jump asked for since. */
  const landFastForward = useCallback(
    (landing: RemoteSeekLanding | null) => {
      if (!jumpAwaited()) land(landing);
      else if (landing) latestLandingRef.current = landing;
    },
    [jumpAwaited, land],
  );

  /** Where the tune is now: the last landing until the page's elapsed time has caught up with it. */
  const currentSeconds = useCallback((): number => {
    const landing = latestLandingRef.current;
    return landing ? landing.seconds + (Date.now() - landing.atMs) / 1000 : live.current.elapsedMs / 1000;
  }, []);

  const jump = useCallback(
    async (toSeconds: number) => {
      const owned = controllerRef.current;
      if (!owned) return;
      seekEpochRef.current += 1;
      setTargetMs(clampMs(toSeconds * 1000));
      headingToRef.current = toSeconds;
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
        headingToRef.current = null;
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
      // A second button held at the same time joins the first gesture rather than starting another,
      // and a step with no press behind it is the card repeating after the hold was ended for it.
      if (!owned || holdRef.current || holdsDownRef.current === 0) return;
      // During a jump, a rewind counts back from where that jump is heading, and queues behind it.
      const fromSeconds = headingToRef.current ?? currentSeconds();
      seekEpochRef.current += 1;
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
              void owned.endFastForward("reached the end").then(landFastForward);
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
    [currentSeconds, landFastForward],
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
      void owned.endFastForward().then(landFastForward);
      return;
    }
    void jump(Math.max(0, hold.fromSeconds - rewindOffsetSeconds(hold.rewindSteps)));
  }, [jump, landFastForward]);

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
    controller && active && !paused
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

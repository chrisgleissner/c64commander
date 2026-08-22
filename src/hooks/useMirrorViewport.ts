/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { avMirrorSession, type AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";
import {
  FIT_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  panViewport,
  setCenter,
  zoomViewport,
  type Viewport,
} from "@/lib/streams/mirrorViewport";
import { MotionTracker } from "@/lib/streams/motionTracker";
import { SubjectTracker, type LockState, type TrackedSubject } from "@/lib/streams/subjectTracker";
import { advanceFollowCamera } from "@/lib/streams/followCamera";
import { InputAffinity, joystickVector } from "@/lib/streams/inputAffinity";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";

const FOLLOW_EASE = 0.28;
const FOLLOW_MIN_INTERVAL_MS = 80; // cap follow re-centres to ~12/s
const MANUAL_FOLLOW_PAUSE_MS = 1500; // manual pan/zoom wins for a moment
const FOLLOW_MIN_SCALE = 1.05; // never follow when essentially fit

/** Half-extent share the subject may drift within before the camera answers. */
const LOCK_DEADZONE_FRACTION = 0.08;
/** Below this the association is a guess, so the camera holds rather than commits. */
const LOCK_CAMERA_MIN_CONFIDENCE = 0.25;
/**
 * How far outside the visible region the subject has to be for the camera to jump rather than
 * travel. Anything the player can still see is worth a smooth move; anything they cannot is a
 * respawn or a room change, and gliding there wastes the second that matters.
 */
const LOCK_SNAP_HALF_EXTENTS = 1.1;
/** How long "Lock lost" stays on screen before the mirror goes back to plain follow-motion. */
const LOCK_LOST_NOTICE_MS = 2000;

/** What the view is currently locked on to, for the reticle and the status chip. */
export interface MirrorLock {
  state: LockState;
  subject: TrackedSubject | null;
  confidence: number;
}

const IDLE_LOCK: MirrorLock = { state: "idle", subject: null, confidence: 0 };

const sameLock = (a: MirrorLock, b: MirrorLock): boolean => {
  if (a.state !== b.state) return false;
  if (Math.abs(a.confidence - b.confidence) > 0.02) return false;
  if (!a.subject || !b.subject) return a.subject === b.subject;
  return Math.abs(a.subject.x - b.subject.x) < 0.002 && Math.abs(a.subject.y - b.subject.y) < 0.002;
};

export interface UseMirrorViewportOptions {
  session?: AvMirrorSession;
  follow?: boolean;
  /**
   * What the app is currently asserting on the joystick, when it is the app the player is
   * steering with. Optional in every sense: without it the tracker behaves exactly as it was
   * fitted, and with it the cue only ever breaks ties between candidates that already qualify.
   */
  heldJoystickInputs?: HeldJoystickInputs;
}

/**
 * Viewport (zoom/pan) state for the immersive mirror, plus the two follow behaviours.
 *
 * "Follow motion" eases the viewport toward whatever changed on screen. "Lock on" sits on top
 * of it: `lockOn` picks the object under a point and the viewport then tracks THAT object,
 * falling back to follow-motion when the lock is lost. A manual pan/zoom always wins briefly.
 * All the math is delegated to the pure `mirrorViewport` / `motionTracker` / `subjectTracker`
 * / `followCamera` modules.
 */
export const useMirrorViewport = ({
  session = avMirrorSession,
  follow = false,
  heldJoystickInputs,
}: UseMirrorViewportOptions = {}) => {
  const [viewport, setViewport] = useState<Viewport>(FIT_VIEWPORT);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const [lock, setLock] = useState<MirrorLock>(IDLE_LOCK);
  const lockRef = useRef(lock);
  lockRef.current = lock;

  const manualPauseUntilRef = useRef(0);
  const lastFollowAtRef = useRef(0);
  const trackerRef = useRef<MotionTracker | null>(null);
  const subjectRef = useRef<SubjectTracker | null>(null);
  const pendingLockRef = useRef<{ x: number; y: number } | null>(null);
  const lastTickRef = useRef(0);
  const nextIntervalRef = useRef(FOLLOW_MIN_INTERVAL_MS);
  const cameraRef = useRef({ x: 0.5, y: 0.5 });
  const lostAtRef = useRef(0);
  const affinityRef = useRef<InputAffinity | null>(null);

  // Every change of the held set is one assertion, timed. "Nothing held" is recorded too: it
  // ends the previous direction's coverage instead of letting it run on and claim motion the
  // player never asked for.
  useEffect(() => {
    const affinity = affinityRef.current;
    if (!affinity) return;
    const held = heldJoystickInputs;
    const vector = joystickVector({
      up: held?.has("up"),
      down: held?.has("down"),
      left: held?.has("left"),
      right: held?.has("right"),
    });
    affinity.assert(vector.dx, vector.dy, Date.now());
  }, [heldJoystickInputs]);

  const markManual = () => {
    manualPauseUntilRef.current = Date.now() + MANUAL_FOLLOW_PAUSE_MS;
  };

  const zoomBy = useCallback((factor: number, focus?: { x: number; y: number }) => {
    markManual();
    setViewport((v) => zoomViewport(v, factor, focus));
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    markManual();
    setViewport((v) => panViewport(v, dx, dy));
  }, []);

  const centerOn = useCallback((cx: number, cy: number) => {
    markManual();
    setViewport((v) => setCenter(v, cx, cy));
  }, []);

  const setScale = useCallback((scale: number) => {
    markManual();
    setViewport((v) => zoomViewport(v, Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) / v.scale));
  }, []);

  const releaseLock = useCallback(() => {
    pendingLockRef.current = null;
    subjectRef.current?.release();
    setLock((current) => (current.state === "idle" ? current : IDLE_LOCK));
  }, []);

  /** Fit gives up the lock as well: asking for the whole picture is asking to stop following one thing. */
  const reset = useCallback(() => {
    markManual();
    releaseLock();
    setViewport(FIT_VIEWPORT);
  }, [releaseLock]);

  /**
   * Lock on to the object under a normalized frame point. The acquisition itself runs on the
   * next frame that arrives — the picked point has to be read out of a real frame, and the hook
   * never holds one of its own.
   */
  const lockOn = useCallback((x: number, y: number) => {
    pendingLockRef.current = { x, y };
  }, []);

  useEffect(() => {
    if (!follow) {
      trackerRef.current = null;
      subjectRef.current = null;
      affinityRef.current = null;
      pendingLockRef.current = null;
      setLock((current) => (current.state === "idle" ? current : IDLE_LOCK));
      return;
    }
    const motion = new MotionTracker();
    const subject = new SubjectTracker();
    const affinity = new InputAffinity();
    trackerRef.current = motion;
    subjectRef.current = subject;
    affinityRef.current = affinity;

    const publish = (next: MirrorLock) => {
      setLock((current) => (sameLock(current, next) ? current : next));
    };

    /** Follow motion — the behaviour "Lock on" is layered on top of, and falls back to. */
    const followMotion = (frame: Uint8Array, height: number, now: number) => {
      const result = motion.update(frame, VIC_FRAME_WIDTH, height);
      if (!result.changed || !result.centroid) return;
      if (now < manualPauseUntilRef.current) return;
      if (now - lastFollowAtRef.current < FOLLOW_MIN_INTERVAL_MS) return;
      if (viewportRef.current.scale < FOLLOW_MIN_SCALE) return;
      lastFollowAtRef.current = now;
      const target = result.centroid;
      setViewport((v) => setCenter(v, v.cx + (target.x - v.cx) * FOLLOW_EASE, v.cy + (target.y - v.cy) * FOLLOW_EASE));
    };

    const unsubscribe = session.subscribeFrames((frame, height = VIC_PAL_HEIGHT) => {
      const now = Date.now();
      const pending = pendingLockRef.current;
      if (pending) {
        pendingLockRef.current = null;
        const acquired = subject.acquire(frame, VIC_FRAME_WIDTH, height, pending.x, pending.y);
        // A new lock is a new question: whether the LAST subject answered the stick says nothing
        // about whether this one does.
        affinity.reset();
        lastTickRef.current = now;
        nextIntervalRef.current = acquired.nextIntervalMs;
        cameraRef.current = { x: viewportRef.current.cx, y: viewportRef.current.cy };
        publish({ state: acquired.state, subject: acquired.subject, confidence: acquired.confidence });
        return;
      }

      if (subject.state === "idle" || subject.state === "lost") {
        // Time out the "Lock lost" notice rather than leaving it on screen for the rest of the
        // session; a timer would have to be torn down, and the frames are already arriving.
        if (lockRef.current.state === "lost" && now - lostAtRef.current > LOCK_LOST_NOTICE_MS) publish(IDLE_LOCK);
        followMotion(frame, height, now);
        return;
      }

      if (now - lastTickRef.current < nextIntervalRef.current) return;
      const dtMs = now - lastTickRef.current;
      const expected = affinity.expected(lastTickRef.current, now);
      lastTickRef.current = now;
      const result = subject.update(frame, VIC_FRAME_WIDTH, height, dtMs, {
        expected,
        scale: affinity.bonusScale,
      });
      // Fed only from an accepted measurement, so what it learns is how the GAME answered the
      // stick rather than how the tracker guessed. A game that answers with a rotation, a menu or
      // a scrolling world drives the bonus back to zero by itself.
      if (result.measured) affinity.observe(result.measured.dx, result.measured.dy, dtMs, expected);
      nextIntervalRef.current = result.nextIntervalMs;
      publish({ state: result.state, subject: result.subject, confidence: result.confidence });

      if (result.state === "lost") {
        lostAtRef.current = now;
        // The subject is gone for good. Hand the viewport back to follow-motion rather than
        // leaving it parked on the empty background where the subject used to be.
        motion.reset();
        return;
      }
      // While the user is panning by hand the camera rides along with them, so releasing the
      // finger resumes from where they left it instead of snapping back.
      if (now < manualPauseUntilRef.current) {
        cameraRef.current = { x: viewportRef.current.cx, y: viewportRef.current.cy };
        return;
      }
      if (!result.subject) return;
      if (result.state === "searching" || result.confidence < LOCK_CAMERA_MIN_CONFIDENCE) return;
      if (viewportRef.current.scale < FOLLOW_MIN_SCALE) return;
      const halfExtent = 0.5 / viewportRef.current.scale;
      const next = advanceFollowCamera(cameraRef.current, result.subject, dtMs, {
        deadzone: LOCK_DEADZONE_FRACTION * halfExtent,
        snapDistance: LOCK_SNAP_HALF_EXTENTS * halfExtent,
      });
      cameraRef.current = next;
      setViewport((v) => setCenter(v, next.x, next.y));
    });

    return () => {
      unsubscribe();
      trackerRef.current = null;
      subjectRef.current = null;
      affinityRef.current = null;
    };
  }, [follow, session]);

  return useMemo(
    () => ({ viewport, lock, zoomBy, panBy, centerOn, setScale, reset, lockOn, releaseLock }),
    [viewport, lock, zoomBy, panBy, centerOn, setScale, reset, lockOn, releaseLock],
  );
};

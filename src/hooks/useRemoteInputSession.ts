/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getC64API } from "@/lib/c64api";
import type { KeyboardInputName, MachineInputEvent } from "@/lib/c64api";
import { addErrorLog, buildErrorLogDetails } from "@/lib/logging";
import type { RemoteInputTier } from "@/lib/remoteInput/capabilityTier";
import { remoteInputSupportsJoystick } from "@/lib/remoteInput/capabilityTier";
import {
  charToKeyboardInputEvents,
  chunkMachineInputEvents,
  keyboardInputsToChar,
} from "@/lib/remoteInput/keyboardCharMapping";
import type { CursorDirection } from "@/lib/remoteInput/cursorKeyMapping";
import { cursorDirectionToKeyboardInputEvent, cursorKeyToPetscii } from "@/lib/remoteInput/cursorKeyMapping";
import { stringToPetsciiBytes } from "@/lib/remoteInput/kernalFallbackEncoding";
import {
  buildReleaseAllEvent,
  EMPTY_HELD_JOYSTICK_INPUTS,
  heldSetDiffToInputBatch,
} from "@/lib/remoteInput/joystickHeldSet";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import {
  collapseTransientKeyboardTaps,
  EMPTY_HELD_KEYBOARD_INPUTS,
  heldKeyboardSetDiffToInputBatch,
} from "@/lib/remoteInput/keyboardHeldSet";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";
import { recordInputLatencySample } from "@/lib/remoteInput/inputLatency";
import {
  applyAutofirePhase,
  AUTOFIRE_RATE_CHANGE_EVENT,
  clampAutofireRateHz,
  loadAutofireRateHz,
  saveAutofireRateHz,
} from "@/lib/remoteInput/autofire";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";
import { specialKeyToKeyboardInputEvent, specialKeyToPetscii } from "@/lib/remoteInput/specialKeyMapping";
import { runSerializedMachineInput } from "@/lib/remoteInput/machineInputThrottle";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";
import { registerActiveInputRelease, unregisterActiveInputRelease } from "@/lib/remoteInput/activeInputRelease";

export type RemoteInputOutputMode = "joystick" | "type";
export type RemoteInputConnectionStatus = "idle" | "sending" | "error";

/** Held-set changes within this window collapse into one network call (device-safety). */
const COALESCE_WINDOW_MS = 40;
/**
 * The window used for the FIRST change since the last flush (nothing else is
 * pending yet): fires on the next tick instead of waiting out the full
 * COALESCE_WINDOW_MS, so a single discrete press/tap reaches the wire in well
 * under it. This does not weaken the hardware-safety story - non-overlap is
 * enforced by machineInputThrottle's serialized queue, not by this window
 * (see its doc comment) - it only changes how quickly the FIRST event of a
 * burst gets flushed. A second change arriving before this near-instant
 * flush fires still rides the same window via scheduleFlushIn's "pull
 * earlier, never later" rule, so a genuine rapid burst (drag, fast typing)
 * still coalesces into one call exactly as before.
 */
const LEADING_EDGE_WINDOW_MS = 0;
/**
 * Issue 3c: autofire duty-cycle edges flush on their own tight window instead of
 * riding the 40ms drag debounce, so autofire stays on a regular cadence at any
 * configured rate. A joystick move that is already pending — or arrives within
 * this window — merges into the same outgoing packet (one call carrying both the
 * move and the toggle); a move further away than this is dispatched on its own
 * 40ms window and is never held hostage waiting for an autofire edge to join.
 */
const AUTOFIRE_COALESCE_WINDOW_MS = 10;

export type UseRemoteInputSessionOptions = {
  tier: RemoteInputTier;
};

export type RemoteInputSession = {
  outputMode: RemoteInputOutputMode;
  setOutputMode: (mode: RemoteInputOutputMode) => void;
  port: 1 | 2;
  setPort: (port: 1 | 2) => void;
  heldJoystickInputs: HeldJoystickInputs;
  setHeldJoystickInputs: (next: HeldJoystickInputs) => void;
  heldKeyboardInputs: HeldKeyboardInputs;
  setHeldKeyboardInputs: (next: HeldKeyboardInputs) => void;
  autofireEnabled: boolean;
  setAutofireEnabled: (enabled: boolean) => void;
  autofireRateHz: number;
  setAutofireRateHz: (rateHz: number) => void;
  connectionStatus: RemoteInputConnectionStatus;
  sendChar: (char: string) => void;
  sendKeyboardInputs: (inputs: KeyboardInputName[]) => void;
  sendCursor: (direction: CursorDirection) => void;
  sendSpecialKey: (key: SpecialKeyboardKey) => void;
  releaseAll: () => void;
};

/**
 * HARD12-017: the fire-and-forget coalesced transport for the remote input
 * sheet. Joystick held-input changes and typed keyboard events both flow
 * through one short debounce window so a drag gesture or a fast burst of
 * keystrokes collapses into a single POST rather than one request per
 * pointermove/keystroke — the C64U's embedded HTTP task is single-threaded
 * and load-fragile (see REVIEW.md "never wedge the hardware"). Never retries
 * a failed batch: on error the local held-set model resets to empty and the
 * next real change re-syncs from a clean slate (drop-coalesce, not queue).
 */
export const useRemoteInputSession = ({ tier }: UseRemoteInputSessionOptions): RemoteInputSession => {
  const [outputMode, setOutputModeState] = useState<RemoteInputOutputMode>("joystick");
  const [port, setPortState] = useState<1 | 2>(2);
  const [heldJoystickInputs, setHeldJoystickInputsState] = useState<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  const [heldKeyboardInputs, setHeldKeyboardInputsState] = useState<HeldKeyboardInputs>(EMPTY_HELD_KEYBOARD_INPUTS);
  const [autofireEnabled, setAutofireEnabled] = useState(false);
  const [autofireRateHz, setAutofireRateHzState] = useState(loadAutofireRateHz);
  const [connectionStatus, setConnectionStatus] = useState<RemoteInputConnectionStatus>("idle");

  const tierRef = useRef(tier);
  tierRef.current = tier;
  const portRef = useRef(port);
  portRef.current = port;
  const lastSentHeldSetRef = useRef<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  const pendingHeldSetRef = useRef<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  const lastSentKeyboardHeldSetRef = useRef<HeldKeyboardInputs>(EMPTY_HELD_KEYBOARD_INPUTS);
  const pendingKeyboardHeldSetRef = useRef<HeldKeyboardInputs>(EMPTY_HELD_KEYBOARD_INPUTS);
  /**
   * Queued press/release events, computed against the PREVIOUS pending set at
   * the moment of each `setHeldKeyboardInputs` call, not lazily diffed at
   * flush time. A snapshot-diff-at-flush-time model loses a key that was
   * pressed AND released again before the flush ever fires (net "no change"
   * between the two snapshots) - which is routine, not rare: a fast tap's
   * pointerdown+pointerup frequently lands in the same event-loop tick as the
   * scheduled flush timer, and silently sending nothing for a real tap is a
   * correctness bug, not an optimization. Queuing each call's own delta as it
   * happens means a transient press-then-release still ships as a real
   * press+release pair.
   */
  const pendingKeyboardEventsRef = useRef<MachineInputEvent[]>([]);
  const pendingTypedEventsRef = useRef<MachineInputEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  /** Wall-clock time the pending flush is scheduled to fire; lets an autofire edge pull it earlier. */
  const flushDueAtRef = useRef<number>(0);
  /**
   * Wall-clock time (`performance.now()`) the FIRST unflushed change landed
   * since the last flush — the moment the user's gesture happened, not when
   * the network call fires. Reset to `null` after every flush so a fresh
   * idle-to-press gesture starts a fresh latency sample rather than measuring
   * against a stale earlier press.
   */
  const pendingChangeAtRef = useRef<number | null>(null);
  /** Explicit autofire duty-cycle phase, flipped only by the dedicated interval below. */
  const autofirePhaseOnRef = useRef(true);
  // HARD13-002: bumped on every immediate (safety-critical) send. A coalesced
  // input send waits out the device-safeguard throttle before it dispatches; an
  // immediate release-all / port-swap release does NOT wait. Without a guard,
  // that immediate release can overtake a still-waiting coalesced press and the
  // press then lands AFTER the release, re-asserting an input the user just
  // cleared - a stuck joystick direction on the device with no local state to
  // reflect it. Each coalesced dispatch captures the generation at schedule time
  // and drops itself if an immediate send has since superseded it.
  const sendGenerationRef = useRef(0);

  // `immediate` bypasses the device-safeguard cooldown (Settings → device
  // safety → machine input cooldown): safety-critical releases (panic
  // button, mode/port swap, unmount) must never be delayed behind it, only
  // the ordinary interactive stream of held-set/typed events is throttled.
  const sendEventsNow = useCallback(
    (events: MachineInputEvent[], options: { immediate?: boolean; gestureAtMs?: number } = {}) => {
      if (!events.length) return;
      const { immediate = false, gestureAtMs } = options;
      if (immediate) sendGenerationRef.current += 1;
      const generation = sendGenerationRef.current;
      setConnectionStatus("sending");
      const batches = chunkMachineInputEvents(events);
      batches.forEach((batch, batchIndex) => {
        // Only the first chunk represents the user's actual gesture-to-dispatch
        // latency; later chunks exist purely because of the batch-size cap, not
        // a separate press, so they carry no sample.
        const batchGestureAtMs = batchIndex === 0 ? gestureAtMs : undefined;
        const dispatch = () => {
          if (batchGestureAtMs !== undefined) {
            recordInputLatencySample(performance.now() - batchGestureAtMs, performance.now());
          }
          return getC64API()
            .sendMachineInputBatch({ events: batch })
            .then(() => setConnectionStatus("idle"))
            .catch((error) => {
              addErrorLog(
                "Remote input batch send failed",
                buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), {
                  eventCount: batch.length,
                }),
              );
              // HARD15-007: a batch failure (a timeout especially) does not
              // guarantee the device never applied it - the RESPONSE, not the
              // request, may be what was lost. Capture whether we owe a release
              // before the resets below erase the only signal of it, so a
              // timed-out-but-applied press can still be recovered instead of
              // becoming a release the user's own subsequent release-diff can
              // never produce (drop-coalesce reset it to the same empty state).
              // A "tap" keyboard event (char/special-key/cursor dispatch, or a
              // kernal-fallback-tier chord) is atomic on the device and can
              // never leave anything held — only "press"/"release" (the real
              // hold relay) and joystick events can, so only those warrant it.
              const owedRelease =
                lastSentHeldSetRef.current.size > 0 ||
                lastSentKeyboardHeldSetRef.current.size > 0 ||
                batch.some(
                  (event) => event.kind === "joystick" || (event.kind === "keyboard" && event.transition !== "tap"),
                );
              const wasReleaseAll = batch.length === 1 && batch[0].kind === "release_all";
              // HARD18-001: a queued coalesced batch computed against the
              // now-abandoned held-set model must never dispatch after this
              // reset - bump the generation (the same supersede mechanism an
              // immediate send already uses) so every batch still waiting on
              // runSerializedMachineInput drops itself at its generation
              // check instead of re-asserting a stale press once the device
              // recovers from this failure.
              sendGenerationRef.current += 1;
              // Drop-coalesce, not retry: forget what we thought was held so the
              // next real change re-syncs cleanly instead of compounding drift.
              lastSentHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
              pendingHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
              lastSentKeyboardHeldSetRef.current = EMPTY_HELD_KEYBOARD_INPUTS;
              pendingKeyboardHeldSetRef.current = EMPTY_HELD_KEYBOARD_INPUTS;
              pendingKeyboardEventsRef.current = [];
              setConnectionStatus("error");
              if (owedRelease && !wasReleaseAll) {
                // Direct API call, not routed through sendEventsNow: idempotent
                // and single-shot, so it cannot recurse into this same catch.
                void getC64API()
                  .sendMachineInputBatch({ events: buildReleaseAllEvent() })
                  .catch((releaseError) => {
                    addErrorLog(
                      "Remote input recovery release-all after send failure failed",
                      buildErrorLogDetails(
                        releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
                        {},
                      ),
                    );
                  });
              }
            });
        };
        // Dispatch immediate (safety-critical) sends synchronously, with no
        // serialization wait at all - only the ordinary coalesced stream is
        // serialized so it never overlaps itself on the wire (device-safety).
        if (immediate) {
          void dispatch();
        } else {
          void runSerializedMachineInput(() => {
            // Superseded by a later immediate release/port-swap while we waited:
            // drop this stale press so it can't land after the release (HARD13-002).
            if (generation !== sendGenerationRef.current) return;
            return dispatch();
          });
        }
      });
    },
    [],
  );

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const gestureAtMs = pendingChangeAtRef.current ?? undefined;
    pendingChangeAtRef.current = null;
    const effectiveHeldSet = applyAutofirePhase(pendingHeldSetRef.current, autofireEnabled, autofirePhaseOnRef.current);
    // HARD15-004: only overwrite lastSent when this flush actually relayed a
    // held-set diff. A downgraded-tier flush (heldSetEvents === []) must not
    // silently wipe the "we owe the device a release" signal that setPort and
    // the tier-downgrade effect below both rely on.
    let heldSetEvents: MachineInputEvent[] = [];
    if (tierRef.current === "full" && outputMode === "joystick") {
      heldSetEvents = heldSetDiffToInputBatch(lastSentHeldSetRef.current, effectiveHeldSet, portRef.current);
      lastSentHeldSetRef.current = effectiveHeldSet;
    }
    // Drains the queue built up by setHeldKeyboardInputs (see
    // pendingKeyboardEventsRef's doc comment) rather than diffing two
    // snapshots here, so a transient press-then-release within this window
    // still ships instead of netting out to "no change".
    let keyboardHeldSetEvents: MachineInputEvent[] = [];
    if (tierRef.current === "full") {
      // A same-chord press+release that both landed in this queue before
      // ever reaching the wire collapses to the firmware's own `tap`
      // mechanism (see collapseTransientKeyboardTaps's doc comment) - a
      // literal press+release pair applies with no real delay between them
      // and is not a reliable way to register a keypress on real hardware.
      keyboardHeldSetEvents = collapseTransientKeyboardTaps(pendingKeyboardEventsRef.current);
      pendingKeyboardEventsRef.current = [];
      lastSentKeyboardHeldSetRef.current = pendingKeyboardHeldSetRef.current;
    }
    const typedEvents = pendingTypedEventsRef.current;
    pendingTypedEventsRef.current = [];
    sendEventsNow([...heldSetEvents, ...keyboardHeldSetEvents, ...typedEvents], { gestureAtMs });
  }, [autofireEnabled, outputMode, sendEventsNow]);

  const scheduleFlushIn = useCallback(
    (windowMs: number) => {
      // Deliberately a macrotask (setTimeout), not a microtask, even for the
      // 0ms leading-edge case: a fast tap's pointerdown and pointerup are
      // separate native browser tasks, so a microtask queued during
      // pointerdown's handling runs to completion (and flushes just the
      // press) BEFORE pointerup's task even starts - it never sees the
      // matching release land in the same batch, so a fast tap could never
      // collapse into the firmware's dedicated `tap` transition (see
      // collapseTransientKeyboardTaps). A macrotask timer, even at 0ms, still
      // waits behind whatever other tasks the browser already has queued -
      // in practice both halves of a fast tap - so the pair batches
      // correctly. This does cost some real render/paint time on top for a
      // genuine hold's press specifically; that is a separate, addressable
      // React-render-cost problem, not a reason to trade away correctness.
      const dueAt = Date.now() + windowMs;
      if (flushTimerRef.current !== null) {
        // Only ever pull the pending flush EARLIER, never push it later: an
        // autofire edge (10ms) preempts a drag's pending 40ms window so it is
        // not delayed, while a drag move cannot stall an imminent autofire
        // edge. A pending joystick change already sits in pendingHeldSetRef, so
        // the earlier flush carries it too - that IS the sub-10ms coalescing of
        // a near-simultaneous move + autofire toggle into one packet (Issue 3c).
        if (dueAt >= flushDueAtRef.current) return;
        window.clearTimeout(flushTimerRef.current);
      }
      flushDueAtRef.current = dueAt;
      flushTimerRef.current = window.setTimeout(flush, windowMs);
    },
    [flush],
  );

  // `fastPath` (keyboard only): fire on the leading edge of a burst instead
  // of waiting out the full window. Joystick/autofire deliberately keep the
  // original always-COALESCE_WINDOW_MS behaviour, which is what lets a
  // near-simultaneous drag move and autofire edge merge into one packet
  // (Issue 3c, see scheduleFlushIn) - a fast keyboard path would make the
  // move's flush fire and complete before the autofire edge ever sees it as
  // pending, splitting what should be one call into two.
  const scheduleFlush = useCallback(
    (options: { fastPath?: boolean } = {}) => {
      // Stamp the gesture time only on the leading edge of a burst — a rapid
      // second change riding the same pending flush must not push the
      // sample's start later than the user's actual first press.
      const isLeadingEdge = flushTimerRef.current === null;
      pendingChangeAtRef.current ??= performance.now();
      const windowMs = options.fastPath && isLeadingEdge ? LEADING_EDGE_WINDOW_MS : COALESCE_WINDOW_MS;
      scheduleFlushIn(windowMs);
    },
    [scheduleFlushIn],
  );
  const scheduleKeyboardFlush = useCallback(() => scheduleFlush({ fastPath: true }), [scheduleFlush]);

  const releaseAll = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // HARD13-001: whether we still owe the device a release depends on what we
    // actually relayed, NOT on the current tier. A capability downgrade (full →
    // kernal-fallback via a device switch, connection blip, or transient probe
    // failure) updates `tierRef` to the new tier BEFORE this runs, so gating the
    // network release on `tierRef.current === "full"` made the downgrade safety
    // net inert - it cleared local state but never released the inputs still
    // held on the device. A non-empty last-sent set is only ever populated by
    // the full-tier relay path, so it is a reliable "we owe a release" signal
    // independent of the now-current tier.
    const hadRelayedInputs = lastSentHeldSetRef.current.size > 0 || lastSentKeyboardHeldSetRef.current.size > 0;
    pendingHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
    lastSentHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
    pendingKeyboardHeldSetRef.current = EMPTY_HELD_KEYBOARD_INPUTS;
    lastSentKeyboardHeldSetRef.current = EMPTY_HELD_KEYBOARD_INPUTS;
    pendingKeyboardEventsRef.current = [];
    // Lead F5 (accepted, won't-fix): a typed char still sitting in the 40ms
    // coalesce window when a mode switch calls releaseAll (via setOutputMode)
    // is dropped here rather than flushed first. Confirmed by inspection;
    // requires two taps on different controls within 40ms, so real-world
    // impact is negligible against the risk of touching this safety-critical
    // clearing path for a flush-before-clear fix.
    pendingTypedEventsRef.current = [];
    setHeldJoystickInputsState(EMPTY_HELD_JOYSTICK_INPUTS);
    setHeldKeyboardInputsState(EMPTY_HELD_KEYBOARD_INPUTS);
    // Issue 3e: leaving the joystick overlay - sheet close, output-mode/tab
    // switch (setOutputMode calls this), unmount, tier downgrade, panic button -
    // must also STOP autofire, not merely release the held inputs. Without this
    // its dedicated ticking interval keeps running for the life of the page and
    // reopening the sheet silently resumes firing the user never re-enabled.
    setAutofireEnabled(false);
    autofirePhaseOnRef.current = true;
    if (hadRelayedInputs || tierRef.current === "full") {
      sendEventsNow(buildReleaseAllEvent(), { immediate: true });
    }
  }, [sendEventsNow]);

  const setHeldJoystickInputs = useCallback(
    (next: HeldJoystickInputs) => {
      pendingHeldSetRef.current = next;
      setHeldJoystickInputsState(next);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const setHeldKeyboardInputs = useCallback(
    (next: HeldKeyboardInputs) => {
      pendingKeyboardEventsRef.current.push(
        ...heldKeyboardSetDiffToInputBatch(pendingKeyboardHeldSetRef.current, next),
      );
      pendingKeyboardHeldSetRef.current = next;
      setHeldKeyboardInputsState(next);
      scheduleKeyboardFlush();
    },
    [scheduleKeyboardFlush],
  );

  const setPort = useCallback(
    (nextPort: 1 | 2) => {
      if (nextPort === portRef.current) return;
      // A held direction/fire was already relayed to the OLD port - swapping
      // ports must release it there first (never assume it "moves" with the
      // swap) or it's stranded held forever on a port nothing reads from
      // anymore. This must not wait for the coalesce window: it's a discrete
      // user action, not a burst of pointer/key events. HARD15-004: gate on
      // lastSentHeldSetRef (what was actually relayed) per the HARD13-001
      // doctrine above in releaseAll - pendingHeldSetRef + the current tier
      // can both have already moved on inside the 40ms release-coalesce
      // window, stranding the press on the old port with the release wiped
      // below but never sent.
      if (lastSentHeldSetRef.current.size > 0) {
        sendEventsNow(
          heldSetDiffToInputBatch(lastSentHeldSetRef.current, EMPTY_HELD_JOYSTICK_INPUTS, portRef.current),
          { immediate: true },
        );
      }
      lastSentHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
      setPortState(nextPort);
      if (pendingHeldSetRef.current.size > 0) scheduleFlush();
    },
    [scheduleFlush, sendEventsNow],
  );

  const setOutputMode = useCallback(
    (mode: RemoteInputOutputMode) => {
      if (mode === outputMode) return;
      releaseAll();
      setOutputModeState(mode);
    },
    [outputMode, releaseAll],
  );

  const setAutofireEnabledSafe = useCallback(
    (enabled: boolean) => {
      // Every enable starts at the "on" phase - matches the real-hardware feel
      // of "your press starts the pulse", and gives disable a clean phase to
      // leave from (the value is irrelevant while disabled).
      autofirePhaseOnRef.current = true;
      setAutofireEnabled(enabled);
      // The last-sent state may be mid "off phase" of the duty cycle at the
      // moment autofire is toggled - without forcing a flush here, a user who
      // disables autofire while still physically holding fire would have that
      // hold silently NOT relayed until their next stick/fire change (the base
      // held set never re-syncs on its own once the ticking interval stops).
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const setAutofireRateHz = useCallback((rateHz: number) => {
    const clamped = clampAutofireRateHz(rateHz);
    setAutofireRateHzState(clamped);
    saveAutofireRateHz(clamped);
  }, []);

  // Autofire ticks on its own dedicated interval, one tick per half-cycle, so
  // the toggle IS the timer rather than an incidental sample of elapsed time.
  // The previous design computed "on/off" from `Date.now() % period` but only
  // ever evaluated it whenever the transport's ~40ms coalesce-window flush
  // happened to run - at the (now former) 10Hz default that sampling cadence
  // aliased against the 100ms period and could settle on a single phase
  // forever, silently never firing. An explicit phase flip driven by its own
  // interval cannot alias: each half-cycle gets its own scheduled toggle.
  useEffect(() => {
    if (!autofireEnabled) return;
    autofirePhaseOnRef.current = true;
    const halfPeriodMs = Math.max(500 / Math.max(autofireRateHz, 0.1), 10);
    const timer = window.setInterval(() => {
      autofirePhaseOnRef.current = !autofirePhaseOnRef.current;
      scheduleFlushIn(AUTOFIRE_COALESCE_WINDOW_MS);
    }, halfPeriodMs);
    return () => window.clearInterval(timer);
  }, [autofireEnabled, autofireRateHz, scheduleFlushIn]);

  // Hot-swap the rate when it changes elsewhere (Settings → Remote Input slider)
  // so a live session's ticking interval picks up the new value immediately
  // instead of only on its next mount.
  useEffect(() => {
    const handler = () => setAutofireRateHzState(loadAutofireRateHz());
    window.addEventListener(AUTOFIRE_RATE_CHANGE_EVENT, handler);
    return () => window.removeEventListener(AUTOFIRE_RATE_CHANGE_EVENT, handler);
  }, []);

  const sendChar = useCallback(
    (char: string) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push(...charToKeyboardInputEvents(char));
        scheduleKeyboardFlush();
        return;
      }
      void enqueueKeyboardBufferInjection(getC64API(), stringToPetsciiBytes(char))
        .then((result) => {
          if (!result.dropped) setConnectionStatus("idle");
        })
        .catch((error) => {
          addErrorLog(
            "Remote input kernal-fallback char injection failed",
            buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { char }),
          );
          setConnectionStatus("error");
        });
    },
    [scheduleKeyboardFlush],
  );

  const sendKeyboardInputs = useCallback(
    (inputs: KeyboardInputName[]) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push({ kind: "keyboard", inputs, transition: "tap" });
        scheduleKeyboardFlush();
        return;
      }
      // commodore/ctrl chords have no ASCII/PETSCII equivalent - unavailable on
      // this tier rather than guessed; only round-trippable chords proceed.
      const char = keyboardInputsToChar(inputs);
      if (char === null) return;
      void enqueueKeyboardBufferInjection(getC64API(), stringToPetsciiBytes(char))
        .then((result) => {
          if (!result.dropped) setConnectionStatus("idle");
        })
        .catch((error) => {
          addErrorLog(
            "Remote input kernal-fallback keyboard-chord injection failed",
            buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { inputs }),
          );
          setConnectionStatus("error");
        });
    },
    [scheduleKeyboardFlush],
  );

  const sendCursor = useCallback(
    (direction: CursorDirection) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push(cursorDirectionToKeyboardInputEvent(direction));
        scheduleKeyboardFlush();
        return;
      }
      // HARD16-003: cursor hold-repeat fires at 10/s but each fallback injection
      // costs ~0.6 s on the c64u — drop repeats while the injector is busy so a
      // held key stops ~one injection after release instead of draining a
      // multi-second backlog. A dropped repeat is imperceptible; a backlog is not.
      void enqueueKeyboardBufferInjection(getC64API(), new Uint8Array([cursorKeyToPetscii(direction)]), {
        dropIfBusy: true,
      })
        .then((result) => {
          if (!result.dropped) setConnectionStatus("idle");
        })
        .catch((error) => {
          addErrorLog(
            "Remote input kernal-fallback cursor injection failed",
            buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { direction }),
          );
          setConnectionStatus("error");
        });
    },
    [scheduleKeyboardFlush],
  );

  const sendSpecialKey = useCallback(
    (key: SpecialKeyboardKey) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push(specialKeyToKeyboardInputEvent(key));
        scheduleKeyboardFlush();
        return;
      }
      const petscii = specialKeyToPetscii(key);
      if (petscii === null) return; // RUN/STOP, RESTORE: no kernal-buffer equivalent on this tier.
      void enqueueKeyboardBufferInjection(getC64API(), new Uint8Array([petscii]))
        .then((result) => {
          if (!result.dropped) setConnectionStatus("idle");
        })
        .catch((error) => {
          addErrorLog(
            "Remote input kernal-fallback special-key injection failed",
            buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { key }),
          );
          setConnectionStatus("error");
        });
    },
    [scheduleKeyboardFlush],
  );

  // Stuck-input safety net: release everything on unmount, tab/app
  // backgrounding, and whenever the tier stops supporting joystick/keyboard
  // relay. HARD15-004: gate on lastSentHeldSetRef too, not just local UI
  // state - a downgrade landing inside the release-coalesce window (UI
  // already empty, device still pressed) must not skip the release just
  // because heldJoystickInputs happens to read empty at this instant.
  useEffect(() => {
    const joystickNeedsRelease =
      !remoteInputSupportsJoystick(tier) && (heldJoystickInputs.size > 0 || lastSentHeldSetRef.current.size > 0);
    const keyboardNeedsRelease =
      tier !== "full" && (heldKeyboardInputs.size > 0 || lastSentKeyboardHeldSetRef.current.size > 0);
    if (joystickNeedsRelease || keyboardNeedsRelease) releaseAll();
  }, [tier]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") releaseAll();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [releaseAll]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      // HARD13-001: a non-empty last-sent set is only ever populated by the
      // full-tier relay, so it alone signals "we owe the device a release" -
      // don't additionally gate on the current tier, which may already have
      // been downgraded (unmount triggered by a device switch / disconnect).
      if (lastSentHeldSetRef.current.size > 0 || lastSentKeyboardHeldSetRef.current.size > 0) {
        sendGenerationRef.current += 1;
        void getC64API()
          .sendMachineInputBatch({ events: buildReleaseAllEvent() })
          .catch((error) => {
            addErrorLog(
              "Remote input release-all on unmount failed",
              buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), {}),
            );
          });
      }
    };
  }, []);

  // HARD13-001 residual (E1): registers this session as the one that can
  // release a relayed input on demand, awaited by a saved-device switch
  // BEFORE it retargets the API - otherwise the switch's eventual release-all
  // hits the NEW device while the OLD one keeps the input pressed. Reads and
  // mutates only refs/the stable state setter, so registering once on mount
  // (empty deps) is safe - the callback always sees the latest values.
  useEffect(() => {
    const releaseNow = async (): Promise<void> => {
      if (lastSentHeldSetRef.current.size === 0 && lastSentKeyboardHeldSetRef.current.size === 0) return;
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
      lastSentHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
      pendingKeyboardHeldSetRef.current = EMPTY_HELD_KEYBOARD_INPUTS;
      lastSentKeyboardHeldSetRef.current = EMPTY_HELD_KEYBOARD_INPUTS;
      pendingKeyboardEventsRef.current = [];
      pendingTypedEventsRef.current = [];
      setHeldJoystickInputsState(EMPTY_HELD_JOYSTICK_INPUTS);
      setHeldKeyboardInputsState(EMPTY_HELD_KEYBOARD_INPUTS);
      sendGenerationRef.current += 1;
      await getC64API()
        .sendMachineInputBatch({ events: buildReleaseAllEvent() })
        .catch((error) => {
          addErrorLog(
            "Remote input pre-switch release-all failed",
            buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), {}),
          );
        });
    };
    registerActiveInputRelease(releaseNow);
    return () => unregisterActiveInputRelease(releaseNow);
  }, []);

  return {
    outputMode,
    setOutputMode,
    port,
    setPort,
    heldJoystickInputs,
    setHeldJoystickInputs,
    heldKeyboardInputs,
    setHeldKeyboardInputs,
    autofireEnabled,
    setAutofireEnabled: setAutofireEnabledSafe,
    autofireRateHz,
    setAutofireRateHz,
    connectionStatus,
    sendChar,
    sendKeyboardInputs,
    sendCursor,
    sendSpecialKey,
    releaseAll,
  };
};

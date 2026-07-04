/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getC64API } from "@/lib/c64api";
import type { JoystickInputName, KeyboardInputName, MachineInputEvent } from "@/lib/c64api";
import { injectAutostart } from "@/lib/playback/autostart";
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
import { autofireCycle, DEFAULT_AUTOFIRE_RATE_HZ } from "@/lib/remoteInput/autofire";
import type { SpecialKeyboardKey } from "@/lib/remoteInput/specialKeyMapping";
import { specialKeyToKeyboardInputEvent, specialKeyToPetscii } from "@/lib/remoteInput/specialKeyMapping";
import { waitForMachineInputThrottle } from "@/lib/remoteInput/machineInputThrottle";

export type RemoteInputOutputMode = "joystick" | "type";
export type RemoteInputConnectionStatus = "idle" | "sending" | "error";

/** Held-set changes within this window collapse into one network call (device-safety). */
const COALESCE_WINDOW_MS = 40;

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
  const [autofireEnabled, setAutofireEnabled] = useState(false);
  const [autofireRateHz, setAutofireRateHz] = useState(DEFAULT_AUTOFIRE_RATE_HZ);
  const [connectionStatus, setConnectionStatus] = useState<RemoteInputConnectionStatus>("idle");

  const tierRef = useRef(tier);
  tierRef.current = tier;
  const portRef = useRef(port);
  portRef.current = port;
  const lastSentHeldSetRef = useRef<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  const pendingHeldSetRef = useRef<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  const pendingTypedEventsRef = useRef<MachineInputEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const autofireStartedAtMsRef = useRef<number | null>(null);
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
  const sendEventsNow = useCallback((events: MachineInputEvent[], options: { immediate?: boolean } = {}) => {
    if (!events.length) return;
    const { immediate = false } = options;
    if (immediate) sendGenerationRef.current += 1;
    const generation = sendGenerationRef.current;
    setConnectionStatus("sending");
    for (const batch of chunkMachineInputEvents(events)) {
      const dispatch = () =>
        getC64API()
          .sendMachineInputBatch({ events: batch })
          .then(() => setConnectionStatus("idle"))
          .catch((error) => {
            addErrorLog(
              "Remote input batch send failed",
              buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), {
                eventCount: batch.length,
              }),
            );
            // Drop-coalesce, not retry: forget what we thought was held so the
            // next real change re-syncs cleanly instead of compounding drift.
            lastSentHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
            pendingHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
            setConnectionStatus("error");
          });
      // Dispatch immediate (safety-critical) sends synchronously, with no
      // throttle wait at all - only the ordinary coalesced stream awaits it.
      if (immediate) {
        void dispatch();
      } else {
        void waitForMachineInputThrottle().then(() => {
          // Superseded by a later immediate release/port-swap while we waited:
          // drop this stale press so it can't land after the release (HARD13-002).
          if (generation !== sendGenerationRef.current) return;
          return dispatch();
        });
      }
    }
  }, []);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const effectiveHeldSet = autofireEnabled
      ? autofireCycle(
          pendingHeldSetRef.current,
          { enabled: true, rateHz: autofireRateHz, startedAtMs: autofireStartedAtMsRef.current ?? Date.now() },
          Date.now(),
        )
      : pendingHeldSetRef.current;
    const heldSetEvents =
      tierRef.current === "full" && outputMode === "joystick"
        ? heldSetDiffToInputBatch(lastSentHeldSetRef.current, effectiveHeldSet, portRef.current)
        : [];
    lastSentHeldSetRef.current = effectiveHeldSet;
    const typedEvents = pendingTypedEventsRef.current;
    pendingTypedEventsRef.current = [];
    sendEventsNow([...heldSetEvents, ...typedEvents]);
  }, [autofireEnabled, autofireRateHz, outputMode, sendEventsNow]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(flush, COALESCE_WINDOW_MS);
  }, [flush]);

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
    const hadRelayedInputs = lastSentHeldSetRef.current.size > 0;
    pendingHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
    lastSentHeldSetRef.current = EMPTY_HELD_JOYSTICK_INPUTS;
    pendingTypedEventsRef.current = [];
    setHeldJoystickInputsState(EMPTY_HELD_JOYSTICK_INPUTS);
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

  const setPort = useCallback(
    (nextPort: 1 | 2) => {
      if (nextPort === portRef.current) return;
      // A held direction/fire was already relayed to the OLD port - swapping
      // ports must release it there first (never assume it "moves" with the
      // swap) or it's stranded held forever on a port nothing reads from
      // anymore. This must not wait for the coalesce window: it's a discrete
      // user action, not a burst of pointer/key events.
      if (pendingHeldSetRef.current.size > 0 && tierRef.current === "full") {
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
      autofireStartedAtMsRef.current = enabled ? Date.now() : null;
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

  // Autofire ticks on a timer so the held fire input keeps oscillating even
  // when the user isn't moving the stick (a static held press).
  useEffect(() => {
    if (!autofireEnabled || !pendingHeldSetRef.current.has("fire" as JoystickInputName)) return;
    const intervalMs = Math.max(1000 / Math.max(autofireRateHz, 0.1) / 4, 10);
    const timer = window.setInterval(scheduleFlush, intervalMs);
    return () => window.clearInterval(timer);
  }, [autofireEnabled, autofireRateHz, heldJoystickInputs, scheduleFlush]);

  const sendChar = useCallback(
    (char: string) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push(...charToKeyboardInputEvents(char));
        scheduleFlush();
        return;
      }
      void injectAutostart(getC64API(), stringToPetsciiBytes(char)).catch((error) => {
        addErrorLog(
          "Remote input kernal-fallback char injection failed",
          buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { char }),
        );
        setConnectionStatus("error");
      });
    },
    [scheduleFlush],
  );

  const sendKeyboardInputs = useCallback(
    (inputs: KeyboardInputName[]) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push({ kind: "keyboard", inputs, transition: "tap" });
        scheduleFlush();
        return;
      }
      // commodore/ctrl chords have no ASCII/PETSCII equivalent - unavailable on
      // this tier rather than guessed; only round-trippable chords proceed.
      const char = keyboardInputsToChar(inputs);
      if (char === null) return;
      void injectAutostart(getC64API(), stringToPetsciiBytes(char)).catch((error) => {
        addErrorLog(
          "Remote input kernal-fallback keyboard-chord injection failed",
          buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { inputs }),
        );
        setConnectionStatus("error");
      });
    },
    [scheduleFlush],
  );

  const sendCursor = useCallback(
    (direction: CursorDirection) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push(cursorDirectionToKeyboardInputEvent(direction));
        scheduleFlush();
        return;
      }
      void injectAutostart(getC64API(), new Uint8Array([cursorKeyToPetscii(direction)])).catch((error) => {
        addErrorLog(
          "Remote input kernal-fallback cursor injection failed",
          buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { direction }),
        );
        setConnectionStatus("error");
      });
    },
    [scheduleFlush],
  );

  const sendSpecialKey = useCallback(
    (key: SpecialKeyboardKey) => {
      if (tierRef.current === "full") {
        pendingTypedEventsRef.current.push(specialKeyToKeyboardInputEvent(key));
        scheduleFlush();
        return;
      }
      const petscii = specialKeyToPetscii(key);
      if (petscii === null) return; // RUN/STOP, RESTORE: no kernal-buffer equivalent on this tier.
      void injectAutostart(getC64API(), new Uint8Array([petscii])).catch((error) => {
        addErrorLog(
          "Remote input kernal-fallback special-key injection failed",
          buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), { key }),
        );
        setConnectionStatus("error");
      });
    },
    [scheduleFlush],
  );

  // Stuck-input safety net: release everything on unmount, tab/app
  // backgrounding, and whenever the tier stops supporting joystick relay.
  useEffect(() => {
    if (!remoteInputSupportsJoystick(tier) && heldJoystickInputs.size > 0) {
      releaseAll();
    }
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
      if (lastSentHeldSetRef.current.size > 0) {
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

  return {
    outputMode,
    setOutputMode,
    port,
    setPort,
    heldJoystickInputs,
    setHeldJoystickInputs,
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

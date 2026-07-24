/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A tiny, dependency-free signal fired whenever the user actively drives the C64 (joystick move,
 * fire, keyboard, cursor). It decouples the Remote Input transport (`useRemoteInputSession`, which
 * knows every input event) from the Live View mirror (`AvMirrorSession`, which sheds video to give
 * input the CPU) — the input side just fires this, the mirror side subscribes.
 *
 * The whole point is LATENCY: the mirror must shed video the instant the user touches a control, not
 * only at the next ~4 Hz governor tick, so a sudden joystick movement reaches the C64 immediately
 * (spec priority: joystick > keyboard > audio > video). Keep the handlers cheap.
 */

type InputActivityListener = (nowMs: number) => void;

const listeners = new Set<InputActivityListener>();
let lastInputAtMs = 0;

const perfNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Fire an input-activity pulse. Called on every C64-bound input event (press/move/release). */
export const notifyInputActivity = (nowMs: number = perfNow()): void => {
  lastInputAtMs = nowMs;
  // Copy to an array so a listener that unsubscribes during dispatch can't perturb iteration.
  for (const listener of [...listeners]) listener(nowMs);
};

/** Subscribe to input-activity pulses. Returns an unsubscribe function. */
export const onInputActivity = (listener: InputActivityListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The monotonic time of the most recent input-activity pulse (0 if none yet). */
export const lastInputActivityMs = (): number => lastInputAtMs;

/** Test seam: reset the module-level state between tests. */
export const __resetInputActivityForTests = (): void => {
  listeners.clear();
  lastInputAtMs = 0;
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";
import type { KeyboardInputName } from "@/lib/c64api";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";

export type KeyboardHoldDispatch = {
  /** Press/release an ordinary (non-modifier) key's resolved matrix inputs. */
  pressKey: (inputs: KeyboardInputName[]) => void;
  releaseKey: (inputs: KeyboardInputName[]) => void;
  /**
   * Press/release a modifier-like key (SHIFT/CTRL/C=, either shift) by
   * physical hold. Not constrained to `StickyModifier` — any single
   * `KeyboardInputName` a caller wants hold-to-chord/tap-to-latch semantics
   * for (e.g. QuickKeysBar's separate left/right SHIFT keys) can use this.
   */
  pressModifier: (modifier: KeyboardInputName) => void;
  releaseModifier: (modifier: KeyboardInputName) => void;
  /** Toggle SHIFT LOCK: left_shift stays asserted until toggled off again. */
  toggleShiftLock: () => void;
  /** Is this modifier currently asserted — physically held, latched, or locked? */
  isModifierActive: (modifier: KeyboardInputName) => boolean;
  shiftLocked: boolean;
};

/**
 * Real hold/release dispatch for the on-screen keyboard, mirroring the
 * joystick's proven held-set architecture (pointer down/up -> a held-input
 * Set -> diffed press/release calls). EVERY key — ordinary or modifier —
 * stays asserted on the wire for exactly as long as its pointer is down, and
 * is released the instant the pointer lifts. There is deliberately NO latch:
 * a bare tap is a genuine press-then-release (the transport collapses a
 * same-flush press+release into a firmware `tap` so a fast tap still
 * registers — see collapseTransientKeyboardTaps), and a hold stays held.
 *
 * This is what makes games playable: e.g. David's Midnight Magic works its
 * flippers by holding C= and SHIFT, which must stay asserted for exactly as
 * long as the buttons are held and must NOT stick when merely tapped. The
 * previous one-shot latch (a bare modifier tap staying asserted for the next
 * key) left C=/SHIFT stuck on the device and made such games unplayable.
 *
 * SHIFT LOCK is the sole intentional exception: an explicit persistent toggle
 * (like the physical SHIFT LOCK keycap) that keeps `left_shift` asserted until
 * toggled off, regardless of the press/release bookkeeping.
 */
export const useKeyboardHoldDispatch = (
  heldKeyboardInputs: HeldKeyboardInputs,
  onHeldKeyboardInputsChange: (next: HeldKeyboardInputs) => void,
): KeyboardHoldDispatch => {
  const heldRef = useRef(heldKeyboardInputs);
  heldRef.current = heldKeyboardInputs;

  // Keys/modifiers whose pointer is currently down (a live hold in progress).
  // Modifiers are tracked here purely so `isModifierActive` can light the key
  // while it is genuinely held; releasing the pointer always releases the key.
  const physicallyHeldRef = useRef<Set<KeyboardInputName>>(new Set());
  const [shiftLocked, setShiftLocked] = useState(false);
  const shiftLockedRef = useRef(shiftLocked);
  shiftLockedRef.current = shiftLocked;
  // Shadowed so pressKey/releaseKey/etc. below can be permanently stable
  // (useCallback with an empty dep array) without lying about a dependency
  // that a caller is free to pass a fresh instance of on every render.
  const onChangeRef = useRef(onHeldKeyboardInputsChange);
  onChangeRef.current = onHeldKeyboardInputsChange;

  // `heldRef.current` is updated immediately (not just echoed back on the next
  // render) so that two add/remove calls within the SAME handler compose
  // correctly instead of the second overwriting the first from a stale
  // snapshot. The transport (useRemoteInputSession) coalesces these held-set
  // changes into batched press/release calls, so simultaneous presses ride one
  // request and each release only clears the keys actually let go.
  const addToHeld = useCallback((names: readonly KeyboardInputName[]) => {
    const next = new Set(heldRef.current);
    names.forEach((name) => next.add(name));
    heldRef.current = next;
    onChangeRef.current(next);
  }, []);
  const removeFromHeld = useCallback((names: readonly KeyboardInputName[]) => {
    const next = new Set(heldRef.current);
    names.forEach((name) => next.delete(name));
    heldRef.current = next;
    onChangeRef.current(next);
  }, []);

  // SHIFT LOCK independently keeps `left_shift` asserted — a pointer release
  // must never release it out from under that lock.
  const canReleaseModifier = useCallback(
    (modifier: KeyboardInputName) => !(modifier === "left_shift" && shiftLockedRef.current),
    [],
  );

  // Every function below is intentionally stable for the component's entire
  // lifetime (empty/all-stable dep arrays, current values read via refs) so a
  // memoized per-key button (React.memo) whose OWN inputs/modifier haven't
  // changed can bail out of re-rendering when some OTHER key is pressed —
  // real, measured latency on a Pixel 4 (~13-34ms) came from re-rendering the
  // ENTIRE keyboard/quick-keys bar on every keystroke; a fresh function
  // identity here for every keystroke would defeat that memoization entirely.
  const pressKey = useCallback((inputs: KeyboardInputName[]) => addToHeld(inputs), [addToHeld]);
  const releaseKey = useCallback((inputs: KeyboardInputName[]) => removeFromHeld(inputs), [removeFromHeld]);

  const pressModifier = useCallback(
    (modifier: KeyboardInputName) => {
      physicallyHeldRef.current.add(modifier);
      addToHeld([modifier]);
    },
    [addToHeld],
  );

  const releaseModifier = useCallback(
    (modifier: KeyboardInputName) => {
      // Pure release: a modifier is held only while its pointer is down. No
      // latch, no chord bookkeeping — pointer up always lets it go (unless a
      // SHIFT LOCK is keeping left_shift asserted).
      physicallyHeldRef.current.delete(modifier);
      if (canReleaseModifier(modifier)) removeFromHeld([modifier]);
    },
    [canReleaseModifier, removeFromHeld],
  );

  const toggleShiftLock = useCallback(() => {
    setShiftLocked((locked) => {
      const next = !locked;
      if (next) {
        addToHeld(["left_shift"]);
      } else if (!physicallyHeldRef.current.has("left_shift")) {
        removeFromHeld(["left_shift"]);
      }
      return next;
    });
  }, [addToHeld, removeFromHeld]);

  const isModifierActive = useCallback(
    (modifier: KeyboardInputName) =>
      physicallyHeldRef.current.has(modifier) || (modifier === "left_shift" && shiftLockedRef.current),
    [],
  );

  return {
    pressKey,
    releaseKey,
    pressModifier,
    releaseModifier,
    toggleShiftLock,
    isModifierActive,
    shiftLocked,
  };
};

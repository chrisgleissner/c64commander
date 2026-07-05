/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useRef, useState } from "react";
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
 * Set -> diffed press/release calls) instead of the old one-shot "tap"
 * model. An ordinary key simply stays asserted for as long as it is held.
 *
 * Sticky modifiers (SHIFT/CTRL/C=) get a hybrid so neither existing UX nor
 * real hardware behaviour regresses:
 *  - Hold the modifier while another key goes down (a real two-finger
 *    chord) -> released the instant the modifier itself is released,
 *    exactly like a physical keyboard.
 *  - Tap the modifier alone (down+up with nothing else pressed meanwhile)
 *    -> stays asserted as a one-shot latch for the NEXT key, then auto-clears
 *    when that key is released — preserving today's single-finger
 *    tap-then-tap convenience.
 * SHIFT LOCK is independent of both: once engaged it keeps `left_shift`
 * asserted regardless of any hold/latch bookkeeping above, until toggled off.
 */
export const useKeyboardHoldDispatch = (
  heldKeyboardInputs: HeldKeyboardInputs,
  onHeldKeyboardInputsChange: (next: HeldKeyboardInputs) => void,
): KeyboardHoldDispatch => {
  const heldRef = useRef(heldKeyboardInputs);
  heldRef.current = heldKeyboardInputs;

  // Modifiers whose pointer is currently down (a live hold in progress).
  const physicallyHeldRef = useRef<Set<KeyboardInputName>>(new Set());
  // Subset of the above that saw another key pressed while held — i.e. a
  // real chord happened, so release must be immediate rather than latched.
  const chordedRef = useRef<Set<KeyboardInputName>>(new Set());
  // Modifiers latched by a bare tap, asserted on the wire, awaiting the next
  // ordinary key's release to auto-clear. Reactive so the UI can show it.
  const [pendingLatch, setPendingLatch] = useState<ReadonlySet<KeyboardInputName>>(new Set());
  const [shiftLocked, setShiftLocked] = useState(false);

  // `heldRef.current` is updated immediately (not just echoed back on the next
  // render) so that two add/remove calls within the SAME handler — e.g.
  // releaseKey's own release plus a pending-latch flush — compose correctly
  // instead of the second call overwriting the first from a stale snapshot.
  const addToHeld = (names: readonly KeyboardInputName[]) => {
    const next = new Set(heldRef.current);
    names.forEach((name) => next.add(name));
    heldRef.current = next;
    onHeldKeyboardInputsChange(next);
  };
  const removeFromHeld = (names: readonly KeyboardInputName[]) => {
    const next = new Set(heldRef.current);
    names.forEach((name) => next.delete(name));
    heldRef.current = next;
    onHeldKeyboardInputsChange(next);
  };

  // SHIFT LOCK independently keeps `left_shift` asserted — the hold/latch
  // bookkeeping above must never release it out from under that lock.
  const canReleaseModifier = (modifier: KeyboardInputName) => !(modifier === "left_shift" && shiftLocked);

  const noteOtherKeyPressed = () => {
    physicallyHeldRef.current.forEach((modifier) => chordedRef.current.add(modifier));
  };

  const pressKey = (inputs: KeyboardInputName[]) => {
    noteOtherKeyPressed();
    addToHeld(inputs);
  };

  const releaseKey = (inputs: KeyboardInputName[]) => {
    removeFromHeld(inputs);
    if (pendingLatch.size > 0) {
      const toRelease = [...pendingLatch].filter(canReleaseModifier);
      if (toRelease.length > 0) removeFromHeld(toRelease);
      setPendingLatch(new Set());
    }
  };

  const pressModifier = (modifier: KeyboardInputName) => {
    noteOtherKeyPressed();
    physicallyHeldRef.current.add(modifier);
    addToHeld([modifier]);
  };

  const releaseModifier = (modifier: KeyboardInputName) => {
    physicallyHeldRef.current.delete(modifier);
    if (chordedRef.current.has(modifier)) {
      // A real chord happened while this modifier was held: release now.
      chordedRef.current.delete(modifier);
      if (canReleaseModifier(modifier)) removeFromHeld([modifier]);
      return;
    }
    if (pendingLatch.has(modifier)) {
      // Re-tapping an already-latched modifier cancels the latch.
      setPendingLatch((prev) => {
        const next = new Set(prev);
        next.delete(modifier);
        return next;
      });
      if (canReleaseModifier(modifier)) removeFromHeld([modifier]);
      return;
    }
    // A bare tap with nothing chorded: keep it asserted as a one-shot latch
    // for the next ordinary key (stays in heldKeyboardInputs already).
    setPendingLatch((prev) => new Set(prev).add(modifier));
  };

  const toggleShiftLock = () => {
    setShiftLocked((locked) => {
      const next = !locked;
      if (next) {
        addToHeld(["left_shift"]);
      } else if (!physicallyHeldRef.current.has("left_shift") && !pendingLatch.has("left_shift")) {
        removeFromHeld(["left_shift"]);
      }
      return next;
    });
  };

  const isModifierActive = (modifier: KeyboardInputName) =>
    physicallyHeldRef.current.has(modifier) ||
    pendingLatch.has(modifier) ||
    (modifier === "left_shift" && shiftLocked);

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

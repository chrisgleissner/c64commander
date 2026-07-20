/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  // HARD21-001: a monotonically increasing release-all signal from the session
  // (see useRemoteInputSession.releaseAllEpoch). When it changes, this hook's
  // own contribution/physically-held refs are reset to match the cleared shared
  // set. Passed by every real caller; optional only so the hook stays usable in
  // isolation.
  releaseAllEpoch?: number,
): KeyboardHoldDispatch => {
  const heldRef = useRef(heldKeyboardInputs);
  heldRef.current = heldKeyboardInputs;

  // Keys/modifiers whose pointer is currently down (a live hold in progress).
  // Modifiers are tracked here purely so `isModifierActive` can light the key
  // while it is genuinely held; releasing the pointer always releases the key.
  const physicallyHeldRef = useRef<Set<KeyboardInputName>>(new Set());
  const heldContributionsRef = useRef<Map<KeyboardInputName, number>>(new Map());
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
    names.forEach((name) => {
      // HARD20-002: shifted chords, physical modifiers, and SHIFT LOCK may
      // independently contribute the same matrix input.
      heldContributionsRef.current.set(name, (heldContributionsRef.current.get(name) ?? 0) + 1);
      next.add(name);
    });
    heldRef.current = next;
    onChangeRef.current(next);
  }, []);
  const removeFromHeld = useCallback((names: readonly KeyboardInputName[]) => {
    const next = new Set(heldRef.current);
    names.forEach((name) => {
      const nextContributionCount = (heldContributionsRef.current.get(name) ?? 0) - 1;
      if (nextContributionCount > 0) {
        heldContributionsRef.current.set(name, nextContributionCount);
      } else {
        heldContributionsRef.current.delete(name);
        next.delete(name);
      }
    });
    heldRef.current = next;
    onChangeRef.current(next);
  }, []);

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
      // latch. Contribution tracking preserves any independent SHIFT LOCK or
      // shifted-chord reference.
      physicallyHeldRef.current.delete(modifier);
      removeFromHeld([modifier]);
    },
    [removeFromHeld],
  );

  const toggleShiftLock = useCallback(() => {
    // Read the current value via the ref and call addToHeld/removeFromHeld
    // as ordinary statements here, NOT from inside setShiftLocked's own
    // functional updater: React runs that updater during the render/
    // reconciliation phase, and addToHeld/removeFromHeld's onChangeRef call
    // reaches into a DIFFERENT component's state (heldKeyboardInputs is
    // owned one level up, in useRemoteInputSession) - triggering React's
    // "Cannot update a component while rendering a different component"
    // escape hatch, which defers that update to its OWN extra render pass
    // instead of batching it with this one. That one-render lag is harmless
    // on its own, but the HARD18-002 effect below compares shiftLocked
    // against heldKeyboardInputs and would misread the transient
    // (shiftLocked=true, held=stale-without-left_shift) state as an
    // external clear, immediately undoing the very toggle just requested.
    const next = !shiftLockedRef.current;
    setShiftLocked(next);
    if (next) {
      addToHeld(["left_shift"]);
    } else {
      removeFromHeld(["left_shift"]);
    }
  }, [addToHeld, removeFromHeld]);

  const isModifierActive = useCallback(
    (modifier: KeyboardInputName) =>
      physicallyHeldRef.current.has(modifier) || (modifier === "left_shift" && shiftLockedRef.current),
    [],
  );

  // HARD18-002: releaseAll (panic button, backgrounding/visibilitychange,
  // unmount, device switch) clears the SESSION's held-keyboard set and sends
  // release_all to the device - left_shift is genuinely released on the C64 -
  // but has no channel to reset THIS hook's own shiftLocked state, leaving
  // the SHIFT LOCK key lit while every subsequent keypress relays unshifted.
  // Toggling the lock on/off is the only normal-typing path that ever removes
  // left_shift from heldKeyboardInputs while locked (and it clears shiftLocked
  // itself in the same update, so this is a no-op there) - a held set that
  // loses left_shift some other way while still locked can only mean it was
  // cleared out from under the lock, so drop the stale lock to match.
  useEffect(() => {
    if (shiftLocked && !heldKeyboardInputs.has("left_shift")) {
      setShiftLocked(false);
    }
  }, [shiftLocked, heldKeyboardInputs]);

  // HARD21-001: releaseAll (panic button, backgrounding/visibilitychange, device
  // switch, mode switch) clears the SESSION's shared held-keyboard set DIRECTLY,
  // bypassing removeFromHeld — so this hook's own contribution-count map
  // (heldContributionsRef) and physically-held set are never decremented and keep
  // a stale count for whatever was held at releaseAll time. That orphaned count is
  // permanently off-by-one: the next SHIFT LOCK on/off (or modifier press/release)
  // cycle can never bring it back to 0, so removeFromHeld never drops the input
  // from the held set — it sticks asserted on the C64 while the UI reads it as off
  // (the HARD18-002 effect above only heals shiftLocked, not the count map).
  // Reset both refs on the EXPLICIT releaseAllEpoch signal — NOT on an empty
  // shared set: a concurrent multi-source release (e.g. the QuickKeysBar hook and
  // this one both contributing left_shift, one releasing) can momentarily empty
  // the set while a genuine hold remains, and clearing then would strand the live
  // hold. Clearing already-empty refs on the initial mount is a harmless no-op.
  // Pure ref clears only — NO onChangeRef/setState — so no effect re-render loop.
  useEffect(() => {
    heldContributionsRef.current.clear();
    physicallyHeldRef.current.clear();
  }, [releaseAllEpoch]);

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

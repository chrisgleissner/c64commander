/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useKeyboardHoldDispatch } from "@/hooks/useKeyboardHoldDispatch";
import { EMPTY_HELD_KEYBOARD_INPUTS } from "@/lib/remoteInput/keyboardHeldSet";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";

/**
 * Drives the hook like a controlled component. `held` is real React state
 * owned by this SAME wrapper component (mirroring production, where it is
 * real state one level up in useRemoteInputSession) rather than a plain JS
 * variable manually re-fed via a separate rerender() - a held-set change and
 * this hook's own internal state (e.g. shiftLocked) that both update in the
 * same handler must land in the SAME commit, exactly as React's automatic
 * batching guarantees for two `useState`s updated together in production.
 */
const createDriver = () => {
  const view = renderHook(() => {
    const [held, setHeld] = useState<HeldKeyboardInputs>(EMPTY_HELD_KEYBOARD_INPUTS);
    const dispatch = useKeyboardHoldDispatch(held, setHeld);
    return { held, setHeld, dispatch };
  });
  return {
    heldNames: () => [...view.result.current.held].sort(),
    pressKey: (inputs: string[]) => {
      act(() => view.result.current.dispatch.pressKey(inputs as never));
    },
    releaseKey: (inputs: string[]) => {
      act(() => view.result.current.dispatch.releaseKey(inputs as never));
    },
    pressModifier: (modifier: "left_shift" | "ctrl" | "commodore") => {
      act(() => view.result.current.dispatch.pressModifier(modifier));
    },
    releaseModifier: (modifier: "left_shift" | "ctrl" | "commodore") => {
      act(() => view.result.current.dispatch.releaseModifier(modifier));
    },
    toggleShiftLock: () => {
      act(() => view.result.current.dispatch.toggleShiftLock());
    },
    isModifierActive: (modifier: "left_shift" | "ctrl" | "commodore") =>
      view.result.current.dispatch.isModifierActive(modifier),
    shiftLocked: () => view.result.current.dispatch.shiftLocked,
    // Simulates useRemoteInputSession.releaseAll clearing the SESSION-owned
    // held set directly (bypassing this hook's own press/release/toggle
    // bookkeeping entirely) - the exact "held set cleared out from under the
    // lock" scenario HARD18-002 is about.
    simulateExternalReleaseAll: () => {
      act(() => view.result.current.setHeld(EMPTY_HELD_KEYBOARD_INPUTS));
    },
  };
};

describe("useKeyboardHoldDispatch", () => {
  it("keeps an ordinary key held on the wire for as long as it is pressed", () => {
    const d = createDriver();
    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a"]);
    d.releaseKey(["a"]);
    expect(d.heldNames()).toEqual([]);
  });

  it("keeps a modifier held for exactly as long as its pointer is down, then releases it", () => {
    const d = createDriver();
    d.pressModifier("commodore");
    expect(d.heldNames()).toEqual(["commodore"]);
    expect(d.isModifierActive("commodore")).toBe(true);
    d.releaseModifier("commodore");
    // Pure press/release: pointer up releases the modifier. No latch.
    expect(d.heldNames()).toEqual([]);
    expect(d.isModifierActive("commodore")).toBe(false);
  });

  it("does NOT latch a bare modifier tap onto the next key (regression: stuck C=/SHIFT broke games)", () => {
    const d = createDriver();
    // Tap SHIFT with nothing else pressed meanwhile.
    d.pressModifier("left_shift");
    d.releaseModifier("left_shift");
    // The modifier is fully released; it must NOT stay asserted waiting to
    // latch onto whatever is pressed next.
    expect(d.heldNames()).toEqual([]);
    expect(d.isModifierActive("left_shift")).toBe(false);

    // A key pressed afterwards is therefore unshifted — no phantom modifier.
    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a"]);
    d.releaseKey(["a"]);
    expect(d.heldNames()).toEqual([]);
  });

  it("produces a real simultaneous chord when a modifier is held across another key's press+release", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    expect(d.heldNames()).toEqual(["left_shift"]);
    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a", "left_shift"]);
    d.releaseKey(["a"]);
    // "a" released; shift is still physically held, so it stays down until its
    // own pointer lifts.
    expect(d.heldNames()).toEqual(["left_shift"]);
    d.releaseModifier("left_shift");
    expect(d.heldNames()).toEqual([]);
  });

  it("holds C= and SHIFT together for as long as both are pressed (David's Midnight Magic flippers)", () => {
    const d = createDriver();
    // Both flipper buttons pressed and held.
    d.pressModifier("commodore");
    d.pressModifier("left_shift");
    expect(d.heldNames()).toEqual(["commodore", "left_shift"]);
    expect(d.isModifierActive("commodore")).toBe(true);
    expect(d.isModifierActive("left_shift")).toBe(true);

    // Release one flipper: only that key is released, the other stays held.
    d.releaseModifier("commodore");
    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.isModifierActive("commodore")).toBe(false);
    expect(d.isModifierActive("left_shift")).toBe(true);

    // Release the second flipper.
    d.releaseModifier("left_shift");
    expect(d.heldNames()).toEqual([]);
  });

  it("re-tapping a modifier never accumulates or leaves it stuck", () => {
    const d = createDriver();
    for (let i = 0; i < 5; i += 1) {
      d.pressModifier("ctrl");
      expect(d.heldNames()).toEqual(["ctrl"]);
      d.releaseModifier("ctrl");
      expect(d.heldNames()).toEqual([]);
    }
    expect(d.isModifierActive("ctrl")).toBe(false);
  });

  it("SHIFT LOCK keeps left_shift asserted independently of press/release bookkeeping", () => {
    const d = createDriver();
    d.toggleShiftLock();
    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.shiftLocked()).toBe(true);

    // Tapping an ordinary key must not clear the lock.
    d.pressKey(["a"]);
    d.releaseKey(["a"]);
    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.shiftLocked()).toBe(true);

    d.toggleShiftLock();
    expect(d.heldNames()).toEqual([]);
    expect(d.shiftLocked()).toBe(false);
  });

  it("HARD20-002: keeps SHIFT LOCK asserted while an atomic shifted tap comes and goes", () => {
    const d = createDriver();
    d.toggleShiftLock();
    d.pressKey(["f1", "left_shift"]);
    d.releaseKey(["f1", "left_shift"]);

    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.shiftLocked()).toBe(true);
  });

  it("HARD20-002: keeps a physically held modifier asserted across an atomic shifted tap", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    d.pressKey(["f1", "left_shift"]);
    d.releaseKey(["f1", "left_shift"]);

    expect(d.heldNames()).toEqual(["left_shift"]);
    d.releaseModifier("left_shift");
    expect(d.heldNames()).toEqual([]);
  });

  it("HARD20-002: preserves the shared shift contribution until every held shifted chord releases", () => {
    const d = createDriver();
    d.pressKey(["inst_del", "left_shift"]);
    d.pressKey(["f1", "left_shift"]);
    d.releaseKey(["inst_del", "left_shift"]);

    expect(d.heldNames()).toEqual(["f1", "left_shift"]);
    d.releaseKey(["f1", "left_shift"]);
    expect(d.heldNames()).toEqual([]);
  });

  it("HARD20-002: leaves no contribution behind after a plain shifted-key tap", () => {
    const d = createDriver();
    d.pressKey(["f1", "left_shift"]);
    d.releaseKey(["f1", "left_shift"]);

    expect(d.heldNames()).toEqual([]);
  });

  // HARD18-002: releaseAll (panic button, backgrounding/visibilitychange,
  // unmount, device switch) clears the SESSION's held-keyboard set directly -
  // left_shift is genuinely released on the C64 - but this hook's own
  // shiftLocked state had no channel to learn that, leaving the SHIFT LOCK
  // key lit while every subsequent keypress relayed unshifted.
  it("HARD18-002: drops a stale SHIFT LOCK when the held set is cleared out from under it externally", () => {
    const d = createDriver();
    d.toggleShiftLock();
    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.shiftLocked()).toBe(true);

    d.simulateExternalReleaseAll();

    expect(d.heldNames()).toEqual([]);
    expect(d.shiftLocked()).toBe(false);
    expect(d.isModifierActive("left_shift")).toBe(false);

    // The next keypress relays unshifted (no phantom modifier survives).
    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a"]);
  });

  it("releasing a physically-held SHIFT does not drop the assertion while SHIFT LOCK is engaged", () => {
    const d = createDriver();
    d.toggleShiftLock();
    d.pressModifier("left_shift");
    d.releaseModifier("left_shift"); // pointer up, but the lock still holds it
    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.shiftLocked()).toBe(true);

    // Only toggling the lock off finally releases it.
    d.toggleShiftLock();
    expect(d.heldNames()).toEqual([]);
    expect(d.shiftLocked()).toBe(false);
  });

  it("supports a real three-way chord of two held modifiers and an ordinary key", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    d.pressModifier("ctrl");
    expect(d.heldNames()).toEqual(["ctrl", "left_shift"]);
    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a", "ctrl", "left_shift"]);
    d.releaseKey(["a"]);
    // Both modifiers are still physically held, so both stay down.
    expect(d.heldNames()).toEqual(["ctrl", "left_shift"]);
    d.releaseModifier("ctrl");
    expect(d.heldNames()).toEqual(["left_shift"]);
    d.releaseModifier("left_shift");
    expect(d.heldNames()).toEqual([]);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useKeyboardHoldDispatch } from "@/hooks/useKeyboardHoldDispatch";
import { EMPTY_HELD_KEYBOARD_INPUTS } from "@/lib/remoteInput/keyboardHeldSet";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";

/** Drives the hook like a controlled component: each change is fed back on the next render. */
const createDriver = () => {
  const state = { held: EMPTY_HELD_KEYBOARD_INPUTS as HeldKeyboardInputs };
  const view = renderHook(
    ({ held }: { held: HeldKeyboardInputs }) =>
      useKeyboardHoldDispatch(held, (next) => {
        state.held = next;
      }),
    { initialProps: { held: state.held } },
  );
  const sync = () => view.rerender({ held: state.held });
  return {
    heldNames: () => [...state.held].sort(),
    pressKey: (inputs: string[]) => {
      act(() => view.result.current.pressKey(inputs as never));
      sync();
    },
    releaseKey: (inputs: string[]) => {
      act(() => view.result.current.releaseKey(inputs as never));
      sync();
    },
    pressModifier: (modifier: "left_shift" | "ctrl" | "commodore") => {
      act(() => view.result.current.pressModifier(modifier));
      sync();
    },
    releaseModifier: (modifier: "left_shift" | "ctrl" | "commodore") => {
      act(() => view.result.current.releaseModifier(modifier));
      sync();
    },
    toggleShiftLock: () => {
      act(() => view.result.current.toggleShiftLock());
      sync();
    },
    isModifierActive: (modifier: "left_shift" | "ctrl" | "commodore") => view.result.current.isModifierActive(modifier),
    shiftLocked: () => view.result.current.shiftLocked,
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

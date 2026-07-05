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

  it("produces a real simultaneous chord when a modifier is held across another key's press+release", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    expect(d.heldNames()).toEqual(["left_shift"]);
    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a", "left_shift"]);
    d.releaseKey(["a"]);
    // "a" released; shift was chorded (another key was pressed while it was
    // held) so it stays down until physically released, not auto-cleared.
    expect(d.heldNames()).toEqual(["left_shift"]);
    d.releaseModifier("left_shift");
    expect(d.heldNames()).toEqual([]);
  });

  it("latches a bare modifier tap onto the next key, then auto-clears it", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    d.releaseModifier("left_shift"); // bare tap: nothing else pressed meanwhile
    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.isModifierActive("left_shift")).toBe(true);

    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a", "left_shift"]);
    d.releaseKey(["a"]);
    expect(d.heldNames()).toEqual([]);
    expect(d.isModifierActive("left_shift")).toBe(false);
  });

  it("cancels a pending latch when the same modifier is tapped again", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    d.releaseModifier("left_shift");
    expect(d.heldNames()).toEqual(["left_shift"]);

    d.pressModifier("left_shift");
    d.releaseModifier("left_shift");
    expect(d.heldNames()).toEqual([]);
    expect(d.isModifierActive("left_shift")).toBe(false);
  });

  it("releases a held modifier immediately on physical release when it was let go before any chord", () => {
    const d = createDriver();
    d.pressModifier("ctrl");
    // Released quickly with nothing pressed meanwhile: latches (matches SHIFT).
    d.releaseModifier("ctrl");
    expect(d.heldNames()).toEqual(["ctrl"]);
  });

  it("SHIFT LOCK keeps left_shift asserted independently of hold/latch bookkeeping", () => {
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

  it("does not let a bare SHIFT tap's auto-clear undo an active SHIFT LOCK", () => {
    const d = createDriver();
    d.toggleShiftLock();
    d.pressModifier("left_shift");
    d.releaseModifier("left_shift"); // bare tap while locked
    d.pressKey(["a"]);
    d.releaseKey(["a"]); // would normally auto-clear the pending latch
    expect(d.heldNames()).toEqual(["left_shift"]);
    expect(d.shiftLocked()).toBe(true);
  });

  it("supports a three-way chord: an earlier latch, a held modifier, and a pressed key", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    d.releaseModifier("left_shift"); // latched, pending next key
    d.pressModifier("ctrl"); // real hold
    expect(d.heldNames()).toEqual(["ctrl", "left_shift"]);
    d.pressKey(["a"]);
    expect(d.heldNames()).toEqual(["a", "ctrl", "left_shift"]);
    d.releaseKey(["a"]);
    // shift's one-shot latch clears with the key; ctrl stays (still physically held).
    expect(d.heldNames()).toEqual(["ctrl"]);
    d.releaseModifier("ctrl");
    expect(d.heldNames()).toEqual([]);
  });
});

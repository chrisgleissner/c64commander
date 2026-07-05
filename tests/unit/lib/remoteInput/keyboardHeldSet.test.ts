/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  collapseTransientKeyboardTaps,
  EMPTY_HELD_KEYBOARD_INPUTS,
  heldKeyboardSetDiffToInputBatch,
} from "@/lib/remoteInput/keyboardHeldSet";

describe("heldKeyboardSetDiffToInputBatch", () => {
  it("emits nothing when the held set is unchanged", () => {
    const set = new Set<"a">(["a"]);
    expect(heldKeyboardSetDiffToInputBatch(set, set)).toEqual([]);
  });

  it("emits a single press event for a newly-held key", () => {
    const events = heldKeyboardSetDiffToInputBatch(EMPTY_HELD_KEYBOARD_INPUTS, new Set(["a"]));
    expect(events).toEqual([{ kind: "keyboard", inputs: ["a"], transition: "press" }]);
  });

  it("emits a single release event when a key is let go", () => {
    const events = heldKeyboardSetDiffToInputBatch(new Set(["a"]), EMPTY_HELD_KEYBOARD_INPUTS);
    expect(events).toEqual([{ kind: "keyboard", inputs: ["a"], transition: "release" }]);
  });

  it("coalesces a key swap (one release, one press) into one atomic batch", () => {
    const previous = new Set<"a" | "left_shift" | "b">(["a", "left_shift"]);
    const next = new Set<"a" | "left_shift" | "b">(["b", "left_shift"]);

    const events = heldKeyboardSetDiffToInputBatch(previous, next);

    expect(events).toEqual([
      { kind: "keyboard", inputs: ["b"], transition: "press" },
      { kind: "keyboard", inputs: ["a"], transition: "release" },
    ]);
  });

  it("coalesces a held modifier plus a newly-pressed key into one press event (a real chord)", () => {
    // SHIFT is already held (present in both sets); "a" is newly pressed.
    const previous = new Set<"a" | "left_shift">(["left_shift"]);
    const next = new Set<"a" | "left_shift">(["left_shift", "a"]);

    const events = heldKeyboardSetDiffToInputBatch(previous, next);

    expect(events).toEqual([{ kind: "keyboard", inputs: ["a"], transition: "press" }]);
  });
});

describe("collapseTransientKeyboardTaps", () => {
  it("collapses a same-batch press immediately followed by its own release into one tap event", () => {
    const events = collapseTransientKeyboardTaps([
      { kind: "keyboard", inputs: ["a"], transition: "press" },
      { kind: "keyboard", inputs: ["a"], transition: "release" },
    ]);
    expect(events).toEqual([{ kind: "keyboard", inputs: ["a"], transition: "tap" }]);
  });

  it("leaves a press with no matching release in the same batch untouched (a genuine ongoing hold)", () => {
    const events = collapseTransientKeyboardTaps([{ kind: "keyboard", inputs: ["a"], transition: "press" }]);
    expect(events).toEqual([{ kind: "keyboard", inputs: ["a"], transition: "press" }]);
  });

  it("leaves a bare release untouched (releasing a chord held since a previous flush)", () => {
    const events = collapseTransientKeyboardTaps([{ kind: "keyboard", inputs: ["a"], transition: "release" }]);
    expect(events).toEqual([{ kind: "keyboard", inputs: ["a"], transition: "release" }]);
  });

  it("collapses a fast tap on one key while leaving a genuinely-held modifier's press untouched", () => {
    // Real hold-and-chord: SHIFT is pressed and stays open; "a" is a fast tap
    // (both halves present) nested inside the same batch.
    const events = collapseTransientKeyboardTaps([
      { kind: "keyboard", inputs: ["left_shift"], transition: "press" },
      { kind: "keyboard", inputs: ["a"], transition: "press" },
      { kind: "keyboard", inputs: ["a"], transition: "release" },
    ]);
    expect(events).toEqual([
      { kind: "keyboard", inputs: ["left_shift"], transition: "press" },
      { kind: "keyboard", inputs: ["a"], transition: "tap" },
    ]);
  });

  it("matches a multi-key chord's press+release regardless of array order", () => {
    const events = collapseTransientKeyboardTaps([
      { kind: "keyboard", inputs: ["clr_home", "left_shift"], transition: "press" },
      { kind: "keyboard", inputs: ["left_shift", "clr_home"], transition: "release" },
    ]);
    expect(events).toEqual([{ kind: "keyboard", inputs: ["clr_home", "left_shift"], transition: "tap" }]);
  });

  it("does not touch joystick or release_all events", () => {
    const events = collapseTransientKeyboardTaps([
      { kind: "joystick", port: 2, inputs: ["fire"], transition: "press" },
      { kind: "release_all" },
    ]);
    expect(events).toEqual([
      { kind: "joystick", port: 2, inputs: ["fire"], transition: "press" },
      { kind: "release_all" },
    ]);
  });

  it("treats a repeated press+release+press+release of the same key as two independent taps", () => {
    const events = collapseTransientKeyboardTaps([
      { kind: "keyboard", inputs: ["a"], transition: "press" },
      { kind: "keyboard", inputs: ["a"], transition: "release" },
      { kind: "keyboard", inputs: ["a"], transition: "press" },
      { kind: "keyboard", inputs: ["a"], transition: "release" },
    ]);
    expect(events).toEqual([
      { kind: "keyboard", inputs: ["a"], transition: "tap" },
      { kind: "keyboard", inputs: ["a"], transition: "tap" },
    ]);
  });
});

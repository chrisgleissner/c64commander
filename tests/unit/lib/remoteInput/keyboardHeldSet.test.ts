/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { EMPTY_HELD_KEYBOARD_INPUTS, heldKeyboardSetDiffToInputBatch } from "@/lib/remoteInput/keyboardHeldSet";

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

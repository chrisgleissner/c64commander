/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildReleaseAllEvent,
  EMPTY_HELD_JOYSTICK_INPUTS,
  heldSetDiffToInputBatch,
} from "@/lib/remoteInput/joystickHeldSet";

describe("heldSetDiffToInputBatch", () => {
  it("emits nothing when the held set is unchanged", () => {
    const set = new Set<"up">(["up"]);
    expect(heldSetDiffToInputBatch(set, set, 2)).toEqual([]);
  });

  it("emits a single press event for a newly-held direction", () => {
    const events = heldSetDiffToInputBatch(EMPTY_HELD_JOYSTICK_INPUTS, new Set(["up"]), 2);
    expect(events).toEqual([{ kind: "joystick", port: 2, inputs: ["up"], transition: "press" }]);
  });

  it("emits a single release event when a direction is let go", () => {
    const events = heldSetDiffToInputBatch(new Set(["up"]), EMPTY_HELD_JOYSTICK_INPUTS, 1);
    expect(events).toEqual([{ kind: "joystick", port: 1, inputs: ["up"], transition: "release" }]);
  });

  it("coalesces a direction change (one release, one press) into one atomic batch, never a bare release-all blink", () => {
    // Diagonal held set changing from up+left to up+right: left releases,
    // right presses, up stays held and appears in neither event.
    const previous = new Set<"up" | "left" | "right">(["up", "left"]);
    const next = new Set<"up" | "left" | "right">(["up", "right"]);

    const events = heldSetDiffToInputBatch(previous, next, 2);

    expect(events).toEqual([
      { kind: "joystick", port: 2, inputs: ["right"], transition: "press" },
      { kind: "joystick", port: 2, inputs: ["left"], transition: "release" },
    ]);
  });

  it("coalesces multiple simultaneous presses (e.g. direction + fire) into one press event", () => {
    const events = heldSetDiffToInputBatch(EMPTY_HELD_JOYSTICK_INPUTS, new Set(["up", "fire"]), 1);
    expect(events).toEqual([{ kind: "joystick", port: 1, inputs: ["up", "fire"], transition: "press" }]);
  });
});

describe("buildReleaseAllEvent", () => {
  it("returns a single release_all event regardless of client-tracked state", () => {
    expect(buildReleaseAllEvent()).toEqual([{ kind: "release_all" }]);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindSlot,
  bindingForLayout,
  CLASSIC_T9_BINDING,
  clearSlot,
  DIAMOND8_BINDING,
  isJoystickLayoutId,
  isReservedJoystickAction,
  loadCustomBinding,
  loadJoystickLayout,
  RESERVED_ACTIONS,
  resolveJoystickInputs,
  rotateSlot,
  sanitiseJoystickBinding,
  saveCustomBinding,
  saveJoystickLayout,
  type DeviceRotation,
  type JoystickKeyBinding,
} from "@/lib/remoteInput/joystickKeyBindings";
import type { SemanticAction } from "@/lib/input";

const at = (action: SemanticAction, rotation: DeviceRotation, binding = DIAMOND8_BINDING) =>
  resolveJoystickInputs(action, binding, rotation).sort();

describe("resolveJoystickInputs — the 8-centred diamond, cell by cell", () => {
  // docs/plans/game-mode/game-mode.md §6.3. Each row is one chassis orientation
  // (clockwise from upright) and names the key that must steer each direction.
  const TABLE: ReadonlyArray<{
    rotation: DeviceRotation;
    up: SemanticAction;
    left: SemanticAction;
    right: SemanticAction;
    down: SemanticAction;
    fire: SemanticAction;
  }> = [
    { rotation: 0, up: "digit5", left: "digit7", right: "digit9", down: "digit0", fire: "digit8" },
    { rotation: 90, up: "digit7", left: "digit0", right: "digit5", down: "digit9", fire: "digit8" },
    { rotation: 270, up: "digit9", left: "digit5", right: "digit0", down: "digit7", fire: "digit8" },
    { rotation: 180, up: "digit0", left: "digit9", right: "digit7", down: "digit5", fire: "digit8" },
  ];

  TABLE.forEach(({ rotation, up, left, right, down, fire }) => {
    it(`steers up/left/right/down/fire from the required keys at ${rotation}°`, () => {
      expect(at(up, rotation)).toEqual(["up"]);
      expect(at(left, rotation)).toEqual(["left"]);
      expect(at(right, rotation)).toEqual(["right"]);
      expect(at(down, rotation)).toEqual(["down"]);
      expect(at(fire, rotation)).toEqual(["fire"]);
    });
  });

  it("binds no diagonals, so the reserved keys are never needed to complete the diamond", () => {
    expect(DIAMOND8_BINDING.upLeft).toBeUndefined();
    expect(DIAMOND8_BINDING.upRight).toBeUndefined();
    expect(DIAMOND8_BINDING.downLeft).toBeUndefined();
    expect(DIAMOND8_BINDING.downRight).toBeUndefined();
  });
});

describe("resolveJoystickInputs — Classic T9", () => {
  // Regression guard on the arrangement the app shipped with, expressed against
  // the same keys the removed T9_JOYSTICK_MAP used.
  it("reproduces the shipped cardinals, diagonals and fire at rotation 0", () => {
    expect(at("digit2", 0, CLASSIC_T9_BINDING)).toEqual(["up"]);
    expect(at("digit8", 0, CLASSIC_T9_BINDING)).toEqual(["down"]);
    expect(at("digit4", 0, CLASSIC_T9_BINDING)).toEqual(["left"]);
    expect(at("digit6", 0, CLASSIC_T9_BINDING)).toEqual(["right"]);
    expect(at("digit1", 0, CLASSIC_T9_BINDING)).toEqual(["left", "up"]);
    expect(at("digit3", 0, CLASSIC_T9_BINDING)).toEqual(["right", "up"]);
    expect(at("digit7", 0, CLASSIC_T9_BINDING)).toEqual(["down", "left"]);
    expect(at("digit9", 0, CLASSIC_T9_BINDING)).toEqual(["down", "right"]);
    expect(at("digit5", 0, CLASSIC_T9_BINDING)).toEqual(["fire"]);
  });

  it("rotates its diagonals under the same permutation as its cardinals", () => {
    expect(at("digit1", 90, CLASSIC_T9_BINDING)).toEqual(["right", "up"]);
    expect(at("digit3", 90, CLASSIC_T9_BINDING)).toEqual(["down", "right"]);
    expect(at("digit9", 90, CLASSIC_T9_BINDING)).toEqual(["down", "left"]);
    expect(at("digit7", 90, CLASSIC_T9_BINDING)).toEqual(["left", "up"]);
  });

  it("keeps fire on the same key in every orientation", () => {
    expect(at("digit5", 0, CLASSIC_T9_BINDING)).toEqual(["fire"]);
    expect(at("digit5", 90, CLASSIC_T9_BINDING)).toEqual(["fire"]);
    expect(at("digit5", 180, CLASSIC_T9_BINDING)).toEqual(["fire"]);
    expect(at("digit5", 270, CLASSIC_T9_BINDING)).toEqual(["fire"]);
  });
});

describe("resolveJoystickInputs — the hardware D-pad addition", () => {
  it("steers alongside whichever binding is active", () => {
    expect(at("dpadUp", 0)).toEqual(["up"]);
    expect(at("dpadDown", 0)).toEqual(["down"]);
    expect(at("dpadLeft", 0)).toEqual(["left"]);
    expect(at("dpadRight", 0)).toEqual(["right"]);
    expect(at("center", 0)).toEqual(["fire"]);
    expect(at("dpadUp", 0, CLASSIC_T9_BINDING)).toEqual(["up"]);
  });

  it("turns with the chassis under the same permutation", () => {
    expect(at("dpadUp", 90)).toEqual(["right"]);
    expect(at("dpadLeft", 90)).toEqual(["up"]);
    expect(at("dpadUp", 270)).toEqual(["left"]);
    expect(at("center", 90)).toEqual(["fire"]);
  });

  it("unions with the active binding when a key is bound in both", () => {
    const binding: JoystickKeyBinding = { left: "dpadUp" };
    expect(resolveJoystickInputs("dpadUp", binding, 0).sort()).toEqual(["left", "up"]);
  });

  it("returns nothing for an action no slot is bound to", () => {
    expect(at("digit1", 0)).toEqual([]);
    expect(at("escape", 0)).toEqual([]);
  });
});

describe("rotateSlot", () => {
  it("turns a direction slot clockwise with the chassis", () => {
    expect(rotateSlot("up", 90)).toBe("right");
    expect(rotateSlot("right", 90)).toBe("down");
    expect(rotateSlot("down", 90)).toBe("left");
    expect(rotateSlot("left", 90)).toBe("up");
    expect(rotateSlot("up", 180)).toBe("down");
    expect(rotateSlot("upLeft", 90)).toBe("upRight");
    expect(rotateSlot("upLeft", 270)).toBe("downLeft");
  });

  it("leaves fire where it is, because a fire button has no direction to turn", () => {
    expect(rotateSlot("fire", 0)).toBe("fire");
    expect(rotateSlot("fire", 90)).toBe("fire");
    expect(rotateSlot("fire", 180)).toBe("fire");
    expect(rotateSlot("fire", 270)).toBe("fire");
  });
});

describe("reserved actions", () => {
  it("names the four actions that already do something inside the sheet", () => {
    expect([...RESERVED_ACTIONS].sort()).toEqual(["back", "hash", "openMenu", "star"]);
    expect(isReservedJoystickAction("star")).toBe(true);
    expect(isReservedJoystickAction("digit5")).toBe(false);
  });

  it("never resolves a reserved action to a joystick input, even if one is stored", () => {
    expect(resolveJoystickInputs("hash", { up: "hash" }, 0)).toEqual([]);
  });

  it("is dropped by the binding sanitiser rather than stored", () => {
    expect(sanitiseJoystickBinding({ up: "star", down: "digit2" })).toEqual({ down: "digit2" });
  });
});

describe("sanitiseJoystickBinding", () => {
  it("keeps only structurally valid slot/action pairs", () => {
    expect(sanitiseJoystickBinding({ up: "digit2", nonsense: "digit3", left: 7 })).toEqual({ up: "digit2" });
  });

  it("rejects a stored value that is not an object", () => {
    expect(sanitiseJoystickBinding(null)).toEqual({});
    expect(sanitiseJoystickBinding("digit2")).toEqual({});
    expect(sanitiseJoystickBinding(["digit2"])).toEqual({});
  });
});

describe("bindSlot / clearSlot", () => {
  it("moves an action to its new slot rather than steering two directions at once", () => {
    expect(bindSlot({ up: "digit2", down: "digit8" }, "left", "digit2")).toEqual({ down: "digit8", left: "digit2" });
  });

  it("replaces whatever the target slot held", () => {
    expect(bindSlot({ up: "digit2" }, "up", "digit5")).toEqual({ up: "digit5" });
  });

  it("clears one slot and leaves the rest", () => {
    expect(clearSlot({ up: "digit2", down: "digit8" }, "up")).toEqual({ down: "digit8" });
  });
});

describe("bindingForLayout", () => {
  it("returns the preset for a preset id and the user's own binding for custom", () => {
    const custom: JoystickKeyBinding = { up: "digit1" };
    expect(bindingForLayout("diamond8", custom)).toBe(DIAMOND8_BINDING);
    expect(bindingForLayout("classicT9", custom)).toBe(CLASSIC_T9_BINDING);
    expect(bindingForLayout("custom", custom)).toBe(custom);
  });
});

describe("persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips the layout choice", () => {
    saveJoystickLayout("diamond8");
    expect(loadJoystickLayout()).toBe("diamond8");
    saveJoystickLayout("classicT9");
    expect(loadJoystickLayout()).toBe("classicT9");
  });

  it("falls back to the variant default when nothing valid is stored", () => {
    expect(loadJoystickLayout()).toBe("classicT9");
    localStorage.setItem("c64u_remote_input_joystick_layout", "hexagon");
    expect(loadJoystickLayout()).toBe("classicT9");
  });

  it("ignores a layout id it does not recognise rather than storing it", () => {
    saveJoystickLayout("hexagon" as never);
    expect(localStorage.getItem("c64u_remote_input_joystick_layout")).toBeNull();
    expect(isJoystickLayoutId("hexagon")).toBe(false);
  });

  it("round-trips a custom binding", () => {
    saveCustomBinding({ up: "digit2", fire: "digit5" });
    expect(loadCustomBinding()).toEqual({ up: "digit2", fire: "digit5" });
  });

  it("returns an empty binding, with a warning, when the stored value is malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("c64u_remote_input_joystick_binding", "{not json");
    expect(loadCustomBinding()).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops reserved and unknown entries from a stored binding on read", () => {
    localStorage.setItem(
      "c64u_remote_input_joystick_binding",
      JSON.stringify({ up: "digit2", down: "back", sideways: "digit3" }),
    );
    expect(loadCustomBinding()).toEqual({ up: "digit2" });
  });

  it("returns an empty binding when nothing is stored", () => {
    expect(loadCustomBinding()).toEqual({});
  });
});

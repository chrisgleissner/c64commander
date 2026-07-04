/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { specialKeyToKeyboardInputEvent, specialKeyToPetscii } from "@/lib/remoteInput/specialKeyMapping";

describe("specialKeyToKeyboardInputEvent", () => {
  it("builds a tap event carrying the key name for the REST tier", () => {
    expect(specialKeyToKeyboardInputEvent("run_stop")).toEqual({
      kind: "keyboard",
      inputs: ["run_stop"],
      transition: "tap",
    });
    expect(specialKeyToKeyboardInputEvent("restore")).toEqual({
      kind: "keyboard",
      inputs: ["restore"],
      transition: "tap",
    });
  });

  it("emits the unshifted half of the dual-function keys directly", () => {
    expect(specialKeyToKeyboardInputEvent("f1").inputs).toEqual(["f1"]);
    expect(specialKeyToKeyboardInputEvent("home").inputs).toEqual(["clr_home"]);
    expect(specialKeyToKeyboardInputEvent("del").inputs).toEqual(["inst_del"]);
  });

  it("encodes each high-value shifted operation as a single atomic tap chord (no separate Shift press)", () => {
    // A single `tap` event with the base key + left_shift presses and releases
    // both together on the device, so Shift can never leak or stick.
    expect(specialKeyToKeyboardInputEvent("clr")).toEqual({
      kind: "keyboard",
      inputs: ["clr_home", "left_shift"],
      transition: "tap",
    });
    expect(specialKeyToKeyboardInputEvent("ins")).toEqual({
      kind: "keyboard",
      inputs: ["inst_del", "left_shift"],
      transition: "tap",
    });
    expect(specialKeyToKeyboardInputEvent("f2").inputs).toEqual(["f1", "left_shift"]);
    expect(specialKeyToKeyboardInputEvent("f4").inputs).toEqual(["f3", "left_shift"]);
    expect(specialKeyToKeyboardInputEvent("f6").inputs).toEqual(["f5", "left_shift"]);
    expect(specialKeyToKeyboardInputEvent("f8").inputs).toEqual(["f7", "left_shift"]);
  });
});

describe("specialKeyToPetscii", () => {
  it("resolves F-key PETSCII buffer codes for both the unshifted and shifted halves", () => {
    expect(specialKeyToPetscii("f1")).toBe(0x85);
    expect(specialKeyToPetscii("f3")).toBe(0x86);
    expect(specialKeyToPetscii("f5")).toBe(0x87);
    expect(specialKeyToPetscii("f7")).toBe(0x88);
    expect(specialKeyToPetscii("f2")).toBe(0x89);
    expect(specialKeyToPetscii("f4")).toBe(0x8a);
    expect(specialKeyToPetscii("f6")).toBe(0x8b);
    expect(specialKeyToPetscii("f8")).toBe(0x8c);
  });

  it("resolves HOME/CLR and DEL/INS PETSCII buffer codes", () => {
    expect(specialKeyToPetscii("home")).toBe(0x13);
    expect(specialKeyToPetscii("clr")).toBe(0x93);
    expect(specialKeyToPetscii("del")).toBe(0x14);
    expect(specialKeyToPetscii("ins")).toBe(0x94);
  });

  it("returns null for RUN/STOP and RESTORE, which have no keyboard-buffer byte", () => {
    expect(specialKeyToPetscii("run_stop")).toBeNull();
    expect(specialKeyToPetscii("restore")).toBeNull();
  });
});

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
});

describe("specialKeyToPetscii", () => {
  it("resolves F-key PETSCII buffer codes", () => {
    expect(specialKeyToPetscii("f1")).toBe(0x85);
    expect(specialKeyToPetscii("f3")).toBe(0x86);
    expect(specialKeyToPetscii("f5")).toBe(0x87);
    expect(specialKeyToPetscii("f7")).toBe(0x88);
  });

  it("returns null for RUN/STOP and RESTORE, which have no keyboard-buffer byte", () => {
    expect(specialKeyToPetscii("run_stop")).toBeNull();
    expect(specialKeyToPetscii("restore")).toBeNull();
  });
});

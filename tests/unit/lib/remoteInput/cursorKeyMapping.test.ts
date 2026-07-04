/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  cursorDirectionToKeyboardInputEvent,
  cursorKeyToPetscii,
  PETSCII_INST_DEL,
  PETSCII_RETURN,
} from "@/lib/remoteInput/cursorKeyMapping";

describe("cursorDirectionToKeyboardInputEvent", () => {
  it("maps right and down to the unshifted cursor keys", () => {
    expect(cursorDirectionToKeyboardInputEvent("right")).toEqual({
      kind: "keyboard",
      inputs: ["cursor_left_right"],
      transition: "tap",
    });
    expect(cursorDirectionToKeyboardInputEvent("down")).toEqual({
      kind: "keyboard",
      inputs: ["cursor_up_down"],
      transition: "tap",
    });
  });

  it("maps left and up to the shifted form of the same physical keys", () => {
    expect(cursorDirectionToKeyboardInputEvent("left")).toEqual({
      kind: "keyboard",
      inputs: ["cursor_left_right", "left_shift"],
      transition: "tap",
    });
    expect(cursorDirectionToKeyboardInputEvent("up")).toEqual({
      kind: "keyboard",
      inputs: ["cursor_up_down", "left_shift"],
      transition: "tap",
    });
  });

  it("honors an explicit transition for held cursor auto-repeat", () => {
    expect(cursorDirectionToKeyboardInputEvent("right", "press")).toEqual({
      kind: "keyboard",
      inputs: ["cursor_left_right"],
      transition: "press",
    });
  });
});

describe("cursorKeyToPetscii", () => {
  it("returns the standard PETSCII cursor-control bytes", () => {
    expect(cursorKeyToPetscii("down")).toBe(0x11);
    expect(cursorKeyToPetscii("right")).toBe(0x1d);
    expect(cursorKeyToPetscii("up")).toBe(0x91);
    expect(cursorKeyToPetscii("left")).toBe(0x9d);
  });

  it("exposes RETURN and INST/DEL for the same fallback tier", () => {
    expect(PETSCII_RETURN).toBe(0x0d);
    expect(PETSCII_INST_DEL).toBe(0x14);
  });
});

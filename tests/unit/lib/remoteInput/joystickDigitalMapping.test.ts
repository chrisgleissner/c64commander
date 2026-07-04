/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { dpadActionToJoystickInputs, t9KeyToJoystickInputs } from "@/lib/remoteInput/joystickDigitalMapping";

describe("t9KeyToJoystickInputs", () => {
  it("maps the cardinal numeric-keypad directions per the classic phone-keypad convention", () => {
    expect(t9KeyToJoystickInputs("digit2")).toEqual(["up"]);
    expect(t9KeyToJoystickInputs("digit8")).toEqual(["down"]);
    expect(t9KeyToJoystickInputs("digit4")).toEqual(["left"]);
    expect(t9KeyToJoystickInputs("digit6")).toEqual(["right"]);
  });

  it("maps the corner digits to diagonal held sets", () => {
    expect(t9KeyToJoystickInputs("digit1")).toEqual(["up", "left"]);
    expect(t9KeyToJoystickInputs("digit3")).toEqual(["up", "right"]);
    expect(t9KeyToJoystickInputs("digit7")).toEqual(["down", "left"]);
    expect(t9KeyToJoystickInputs("digit9")).toEqual(["down", "right"]);
  });

  it("maps 5 and 0 to fire", () => {
    expect(t9KeyToJoystickInputs("digit5")).toEqual(["fire"]);
    expect(t9KeyToJoystickInputs("digit0")).toEqual(["fire"]);
  });

  it("returns an empty array for a non-joystick semantic action", () => {
    expect(t9KeyToJoystickInputs("star")).toEqual([]);
    expect(t9KeyToJoystickInputs("back")).toEqual([]);
  });
});

describe("dpadActionToJoystickInputs", () => {
  it("maps hardware D-pad directions straight to joystick directions", () => {
    expect(dpadActionToJoystickInputs("dpadUp")).toEqual(["up"]);
    expect(dpadActionToJoystickInputs("dpadDown")).toEqual(["down"]);
    expect(dpadActionToJoystickInputs("dpadLeft")).toEqual(["left"]);
    expect(dpadActionToJoystickInputs("dpadRight")).toEqual(["right"]);
  });

  it("maps center/select to fire", () => {
    expect(dpadActionToJoystickInputs("center")).toEqual(["fire"]);
  });

  it("returns an empty array for a non-joystick semantic action", () => {
    expect(dpadActionToJoystickInputs("escape")).toEqual([]);
  });
});

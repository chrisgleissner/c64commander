/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildOwnReleaseEvents,
  NO_UNRELEASED_INPUTS,
  withoutReleasedInputs,
  withPressedInputs,
} from "@/lib/remoteInput/ownInputRelease";
import type { MachineInputEvent } from "@/lib/c64api/machineInputTypes";

const nothingHeld = { joystick: new Set<never>(), port: 2 as const, keyboard: new Set<never>() };

describe("buildOwnReleaseEvents", () => {
  it("sends nothing when this phone holds nothing, so another client's inputs stay held", () => {
    expect(buildOwnReleaseEvents(nothingHeld)).toEqual([]);
  });

  it("never releases everything on the device", () => {
    const events = buildOwnReleaseEvents({ joystick: new Set(["fire"]), port: 1, keyboard: new Set(["a"]) }, [
      { kind: "release_all" },
    ]);
    expect(events.some((event) => event.kind === "release_all")).toBe(false);
  });

  it("releases the held joystick inputs on the port they were sent to, and the held keys", () => {
    expect(buildOwnReleaseEvents({ joystick: new Set(["up", "fire"]), port: 1, keyboard: new Set(["f1"]) })).toEqual([
      { kind: "joystick", port: 1, inputs: ["up", "fire"], transition: "release" },
      { kind: "keyboard", inputs: ["f1"], transition: "release" },
    ]);
  });

  it("adds every input a batch with an unknown outcome may have pressed, per port", () => {
    expect(
      buildOwnReleaseEvents({ joystick: new Set(["up"]), port: 2, keyboard: new Set() }, [
        { kind: "joystick", port: 2, inputs: ["up", "right"], transition: "press" },
        { kind: "joystick", port: 1, inputs: ["fire"], transition: "press" },
        { kind: "keyboard", inputs: ["space"], transition: "press" },
      ]),
    ).toEqual([
      { kind: "joystick", port: 2, inputs: ["up", "right"], transition: "release" },
      { kind: "joystick", port: 1, inputs: ["fire"], transition: "release" },
      { kind: "keyboard", inputs: ["space"], transition: "release" },
    ]);
  });

  it("ignores keyboard taps in an unconfirmed batch, which the firmware releases itself", () => {
    expect(buildOwnReleaseEvents(nothingHeld, [{ kind: "keyboard", inputs: ["a"], transition: "tap" }])).toEqual([]);
  });
});

describe("unreleased input record", () => {
  const press = (port: 1 | 2, ...inputs: Array<"up" | "fire" | "left">): MachineInputEvent => ({
    kind: "joystick",
    port,
    inputs,
    transition: "press",
  });
  const release = (port: 1 | 2, ...inputs: Array<"up" | "fire" | "left">): MachineInputEvent => ({
    kind: "joystick",
    port,
    inputs,
    transition: "release",
  });

  it("records joystick and held keyboard presses but not releases, taps or release_all", () => {
    const record = withPressedInputs(NO_UNRELEASED_INPUTS, [
      press(2, "up"),
      release(2, "fire"),
      { kind: "keyboard", inputs: ["a"], transition: "tap" },
      { kind: "keyboard", inputs: ["b"], transition: "press" },
      { kind: "release_all" },
    ]);
    expect(record).toEqual([press(2, "up"), { kind: "keyboard", inputs: ["b"], transition: "press" }]);
  });

  it("removes only the inputs a release names, on the port it named", () => {
    const record = withPressedInputs(NO_UNRELEASED_INPUTS, [press(2, "up", "fire"), press(1, "up")]);
    expect(withoutReleasedInputs(record, [release(2, "up")])).toEqual([press(2, "fire"), press(1, "up")]);
  });

  it("clears everything once a release_all is sent", () => {
    const record = withPressedInputs(NO_UNRELEASED_INPUTS, [press(2, "up")]);
    expect(withoutReleasedInputs(record, [{ kind: "release_all" }])).toEqual([]);
  });

  it("feeds buildOwnReleaseEvents so a release covers an input only a record remembers", () => {
    const record = withPressedInputs(NO_UNRELEASED_INPUTS, [press(2, "up")]);
    expect(buildOwnReleaseEvents(nothingHeld, record)).toEqual([release(2, "up")]);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildOwnReleaseEvents } from "@/lib/remoteInput/ownInputRelease";

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

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REMOTE_INPUT_CONTROL_SIZE,
  gameModeControlScale,
  loadRemoteInputControlSize,
  remoteInputControlScale,
  saveRemoteInputControlSize,
  stepRemoteInputControlSize,
} from "@/lib/remoteInput/remoteInputControlSettings";

const KEY = "c64u_remote_input_control_size";

describe("remoteInputControlSettings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to L (one step above the cramped original M size)", () => {
    expect(DEFAULT_REMOTE_INPUT_CONTROL_SIZE).toBe("L");
    expect(loadRemoteInputControlSize()).toBe("L");
  });

  it("round-trips a saved size through localStorage", () => {
    saveRemoteInputControlSize("XL");
    expect(localStorage.getItem(KEY)).toBe("XL");
    expect(loadRemoteInputControlSize()).toBe("XL");
  });

  it("falls back to the default for a corrupt/unknown persisted value", () => {
    localStorage.setItem(KEY, "GIGANTIC");
    expect(loadRemoteInputControlSize()).toBe("L");
  });

  it("scales up monotonically with size", () => {
    expect(remoteInputControlScale("M")).toBe(1);
    expect(remoteInputControlScale("L")).toBeGreaterThan(remoteInputControlScale("M"));
    expect(remoteInputControlScale("XL")).toBeGreaterThan(remoteInputControlScale("L"));
    expect(remoteInputControlScale("XXL")).toBeGreaterThan(remoteInputControlScale("XL"));
  });

  it("steps within range and clamps at the ends", () => {
    expect(stepRemoteInputControlSize("M", -1)).toBe("M"); // clamped low
    expect(stepRemoteInputControlSize("M", 1)).toBe("L");
    expect(stepRemoteInputControlSize("XL", 1)).toBe("XXL");
    expect(stepRemoteInputControlSize("XXL", 1)).toBe("XXL"); // clamped high
    expect(stepRemoteInputControlSize("XXL", -1)).toBe("XL");
  });

  it("ignores an invalid size on save", () => {
    saveRemoteInputControlSize("bogus" as never);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("gameModeControlScale", () => {
  const L = remoteInputControlScale("L");
  const M = remoteInputControlScale("M");

  // On a Pixel 4 at 320 x 427 CSS px, Game Mode at L left the picture 0 px.
  it("holds the joystick to M in Game Mode on the smallest screen while the picture shows", () => {
    expect(gameModeControlScale({ scale: L, gameMode: true, compact: true, pictureShown: true })).toBe(M);
  });

  it("leaves a size at or below M alone", () => {
    expect(gameModeControlScale({ scale: M, gameMode: true, compact: true, pictureShown: true })).toBe(M);
  });

  it.each([
    ["outside Game Mode", { gameMode: false, compact: true, pictureShown: true }],
    ["on a larger screen", { gameMode: true, compact: false, pictureShown: true }],
    ["with no picture to make room for", { gameMode: true, compact: true, pictureShown: false }],
  ])("keeps the chosen size %s", (_label, context) => {
    expect(gameModeControlScale({ scale: L, ...context })).toBe(L);
  });
});

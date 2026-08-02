/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTROLS_SETTINGS,
  GAME_MODE_CONTROLS_CHANGE_EVENT,
  DEFAULT_GAME_MODE_CONTROLS,
  isControlsSetting,
  loadGameModeControls,
  resolveControlSurface,
  saveGameModeControls,
  type ControlsSetting,
} from "@/lib/remoteInput/gameModeControlSurface";
import type { InputModality } from "@/lib/input/inputModality";

const MODALITIES: readonly InputModality[] = ["pointer", "key-navigation"];

describe("resolveControlSurface — the never-blank guard, and what it does not override", () => {
  it("shows the controls on Auto with the picture off, whatever the modality says", () => {
    MODALITIES.forEach((modality) => {
      expect(resolveControlSurface({ setting: "auto", modality, videoLive: false })).toBe("shown");
    });
  });

  // The guard exists because Auto GUESSES. An explicit answer is not a guess, and overriding
  // it is what made "Never show" read as broken: the user turned the controls off and still
  // saw the joystick.
  it("still hides them on Never show with the picture off", () => {
    MODALITIES.forEach((modality) => {
      expect(resolveControlSurface({ setting: "never", modality, videoLive: false })).toBe("hidden");
    });
  });

  it("still shows them on Always show with the picture off", () => {
    MODALITIES.forEach((modality) => {
      expect(resolveControlSurface({ setting: "always", modality, videoLive: false })).toBe("shown");
    });
  });
});

describe("resolveControlSurface — the full truth table with the picture live", () => {
  const CASES: ReadonlyArray<[ControlsSetting, InputModality, "shown" | "hidden"]> = [
    ["auto", "pointer", "shown"],
    ["auto", "key-navigation", "hidden"],
    ["always", "pointer", "shown"],
    ["always", "key-navigation", "shown"],
    ["never", "pointer", "hidden"],
    ["never", "key-navigation", "hidden"],
  ];

  CASES.forEach(([setting, modality, expected]) => {
    it(`is ${expected} for setting=${setting}, modality=${modality}`, () => {
      expect(resolveControlSurface({ setting, modality, videoLive: true })).toBe(expected);
    });
  });
});

describe("the persisted setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to auto on every variant", () => {
    expect(DEFAULT_GAME_MODE_CONTROLS).toBe("auto");
    expect(loadGameModeControls()).toBe("auto");
  });

  it("round-trips each of the three states", () => {
    CONTROLS_SETTINGS.forEach((setting) => {
      saveGameModeControls(setting);
      expect(loadGameModeControls()).toBe(setting);
    });
  });

  it("falls back to auto rather than trusting an unrecognised stored value", () => {
    localStorage.setItem("c64u_game_mode_controls_visibility", "sometimes");
    expect(loadGameModeControls()).toBe("auto");
    expect(isControlsSetting("sometimes")).toBe(false);
  });

  it("refuses to store an unrecognised setting", () => {
    saveGameModeControls("sometimes" as never);
    expect(localStorage.getItem("c64u_game_mode_controls_visibility")).toBeNull();
  });

  // The Remote Input sheet is mounted for the life of the page, so it has to be told.
  it("announces every change it stores", () => {
    const seen: string[] = [];
    const listener = () => seen.push(loadGameModeControls());
    window.addEventListener(GAME_MODE_CONTROLS_CHANGE_EVENT, listener);

    saveGameModeControls("never");
    saveGameModeControls("always");
    saveGameModeControls("sometimes" as never);

    window.removeEventListener(GAME_MODE_CONTROLS_CHANGE_EVENT, listener);
    expect(seen).toEqual(["never", "always"]);
  });
});

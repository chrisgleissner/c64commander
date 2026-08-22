/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE_JOYSTICK,
  GAME_MODE_JOYSTICK_CHANGE_EVENT,
  GAME_MODE_JOYSTICK_SETTINGS,
  isGameModeJoystickSetting,
  loadGameModeJoystick,
  resolveJoystickVisibility,
  saveGameModeJoystick,
  type GameModeJoystickSetting,
  type JoystickVisibility,
} from "@/lib/remoteInput/gameModeJoystick";

const JOYSTICK_KEY = "c64u_game_mode_controls_visibility";

/** Every combination of the two session facts, for the cases that ignore them. */
const SESSIONS: ReadonlyArray<{ keyDriven: boolean; requested: JoystickVisibility | null }> = [
  { keyDriven: false, requested: null },
  { keyDriven: true, requested: null },
];

describe("resolveJoystickVisibility — with no picture, only a guess is overruled", () => {
  // `auto` is the app guessing, and a guess is not worth an empty screen.
  it("keeps the joystick with the picture off while the setting is auto, however the game is driven", () => {
    SESSIONS.forEach((session) => {
      expect(resolveJoystickVisibility({ setting: "auto", ...session, videoLive: false })).toBe("visible");
    });
  });

  // The keypad handset ships `hidden` because it cannot operate a touch control at all,
  // and Game Mode opens by itself on launch, so ignoring `hidden` here filled its screen
  // with a joystick nobody could touch. RemoteInputSheet fills the space instead.
  it("honours an explicit hidden with the picture off", () => {
    expect(resolveJoystickVisibility({ setting: "hidden", keyDriven: false, requested: null, videoLive: false })).toBe(
      "hidden",
    );
    expect(
      resolveJoystickVisibility({ setting: "auto", keyDriven: false, requested: "hidden", videoLive: false }),
    ).toBe("hidden");
  });

  it("honours an explicit visible with the picture off", () => {
    expect(resolveJoystickVisibility({ setting: "visible", keyDriven: true, requested: null, videoLive: false })).toBe(
      "visible",
    );
  });
});

describe("resolveJoystickVisibility — what hides the joystick, and what does not", () => {
  /**
   * The defect this table was rewritten for: with `auto` and a live picture, the old
   * rule read the app-wide input modality, which ordinary keypad navigation sets
   * anywhere in the app. A user who opened Game Mode with the `0` key arrived with it
   * already set and watched the on-screen joystick disappear a moment later, on a
   * touchscreen, having never driven the game with a key.
   */
  const CASES: ReadonlyArray<{
    setting: GameModeJoystickSetting;
    keyDriven: boolean;
    requested: JoystickVisibility | null;
    expected: JoystickVisibility;
    why: string;
  }> = [
    {
      setting: "auto",
      keyDriven: false,
      requested: null,
      expected: "visible",
      why: "nothing says the keys are in use",
    },
    { setting: "auto", keyDriven: true, requested: null, expected: "hidden", why: "a key steered the game" },
    { setting: "hidden", keyDriven: false, requested: null, expected: "hidden", why: "the setting says hidden" },
    { setting: "visible", keyDriven: true, requested: null, expected: "visible", why: "the setting says visible" },
    {
      setting: "visible",
      keyDriven: false,
      requested: "hidden",
      expected: "hidden",
      why: "the toolbar outranks the setting",
    },
    {
      setting: "hidden",
      keyDriven: true,
      requested: "visible",
      expected: "visible",
      why: "in both directions",
    },
    { setting: "auto", keyDriven: true, requested: "visible", expected: "visible", why: "and it outranks the guess" },
  ];

  CASES.forEach(({ setting, keyDriven, requested, expected, why }) => {
    it(`is ${expected} for setting=${setting}, keyDriven=${keyDriven}, requested=${requested} — ${why}`, () => {
      expect(resolveJoystickVisibility({ setting, keyDriven, requested, videoLive: true })).toBe(expected);
    });
  });
});

describe("the persisted setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to auto on this variant, and to whatever the variant declares", () => {
    expect(DEFAULT_GAME_MODE_JOYSTICK).toBe("auto");
    expect(loadGameModeJoystick()).toBe("auto");
  });

  it("round-trips each of the three states", () => {
    GAME_MODE_JOYSTICK_SETTINGS.forEach((setting) => {
      saveGameModeJoystick(setting);
      expect(loadGameModeJoystick()).toBe(setting);
    });
  });

  it("falls back to the default rather than trusting an unrecognised stored value", () => {
    localStorage.setItem(JOYSTICK_KEY, "sometimes");
    expect(loadGameModeJoystick()).toBe(DEFAULT_GAME_MODE_JOYSTICK);
    expect(isGameModeJoystickSetting("sometimes")).toBe(false);
  });

  it("refuses to store an unrecognised setting", () => {
    saveGameModeJoystick("sometimes" as never);
    expect(localStorage.getItem(JOYSTICK_KEY)).toBeNull();
  });

  // The Remote Input sheet is mounted for the life of the page, so it has to be told.
  it("announces every change it stores", () => {
    const seen: string[] = [];
    const listener = () => seen.push(loadGameModeJoystick());
    window.addEventListener(GAME_MODE_JOYSTICK_CHANGE_EVENT, listener);

    saveGameModeJoystick("hidden");
    saveGameModeJoystick("visible");
    saveGameModeJoystick("sometimes" as never);

    window.removeEventListener(GAME_MODE_JOYSTICK_CHANGE_EVENT, listener);
    expect(seen).toEqual(["hidden", "visible"]);
  });
});

/**
 * The values were renamed from frequencies to states, under the same key and for the
 * same question. A device that chose before the rename must keep its answer.
 */
describe("a preference stored under the old value names", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads always-show-the-controls as visible", () => {
    localStorage.setItem(JOYSTICK_KEY, "always");
    expect(loadGameModeJoystick()).toBe("visible");
  });

  it("reads never-show-the-controls as hidden", () => {
    localStorage.setItem(JOYSTICK_KEY, "never");
    expect(loadGameModeJoystick()).toBe("hidden");
  });

  it("carries auto across unchanged", () => {
    localStorage.setItem(JOYSTICK_KEY, "auto");
    expect(loadGameModeJoystick()).toBe("auto");
  });

  it("writes only the new names, so an old one cannot come back", () => {
    localStorage.setItem(JOYSTICK_KEY, "never");
    saveGameModeJoystick("hidden");
    expect(localStorage.getItem(JOYSTICK_KEY)).toBe("hidden");
  });
});

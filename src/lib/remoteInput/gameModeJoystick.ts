/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { variant } from "@/generated/variant";

/** Whether the on-screen joystick is drawn in Game Mode. */
export type JoystickVisibility = "visible" | "hidden";

/**
 * What the user wants Game Mode to do with the on-screen joystick.
 *
 * The two explicit values name a STATE rather than a frequency, because "always"
 * and "never" only mean something once you already know which way round the
 * question was asked. `auto` waits to be shown that the on-screen joystick is not
 * the one being used — a physical key steering the GAME — and hides it then, giving
 * the live picture the whole screen.
 */
export type GameModeJoystickSetting = "auto" | JoystickVisibility;

export const GAME_MODE_JOYSTICK_SETTINGS: readonly GameModeJoystickSetting[] = ["auto", "visible", "hidden"];

/**
 * `c64u-remote` ships `hidden`: that edition targets a keypad handset with no
 * touchscreen, so an on-screen joystick there is a control nobody can reach taking
 * space from the only thing on the screen that matters.
 */
export const DEFAULT_GAME_MODE_JOYSTICK: GameModeJoystickSetting = isGameModeJoystickSetting(
  variant.runtime.defaultGameModeJoystick,
)
  ? variant.runtime.defaultGameModeJoystick
  : "auto";

export const GAME_MODE_JOYSTICK_LABEL: Record<GameModeJoystickSetting, string> = {
  auto: "Auto",
  visible: "Visible",
  hidden: "Hidden",
};

const JOYSTICK_KEY = "c64u_game_mode_controls_visibility";

/**
 * The names this setting used before its values were expressed as states.
 *
 * Same key and same question — `always` meant "always show the controls" — so this
 * is a rename, not an inversion. Read but never written, so a device that has
 * chosen since the rename has one spelling and one only.
 */
const LEGACY_SETTING_NAMES: Record<string, GameModeJoystickSetting> = {
  always: "visible",
  never: "hidden",
};

export function isGameModeJoystickSetting(value: unknown): value is GameModeJoystickSetting {
  return typeof value === "string" && (GAME_MODE_JOYSTICK_SETTINGS as readonly string[]).includes(value);
}

export const loadGameModeJoystick = (): GameModeJoystickSetting => {
  if (typeof localStorage === "undefined") return DEFAULT_GAME_MODE_JOYSTICK;
  const raw = localStorage.getItem(JOYSTICK_KEY);
  if (isGameModeJoystickSetting(raw)) return raw;
  return (raw !== null ? LEGACY_SETTING_NAMES[raw] : undefined) ?? DEFAULT_GAME_MODE_JOYSTICK;
};

/** Announced on every change, so a Remote Input sheet that is already mounted follows it. */
export const GAME_MODE_JOYSTICK_CHANGE_EVENT = "c64u-game-mode-joystick-changed";

export const saveGameModeJoystick = (setting: GameModeJoystickSetting): void => {
  if (typeof localStorage === "undefined") return;
  if (!isGameModeJoystickSetting(setting)) return;
  localStorage.setItem(JOYSTICK_KEY, setting);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GAME_MODE_JOYSTICK_CHANGE_EVENT));
  }
};

export interface JoystickVisibilityInput {
  readonly setting: GameModeJoystickSetting;
  /**
   * Whether a physical key has steered the GAME since this Game Mode session began.
   *
   * Not the app-wide input modality, which is what this used to read and what made
   * the sheet hide the joystick on a touchscreen: that flag is set by ordinary
   * keypad navigation anywhere in the app, so a user who reached Game Mode by
   * pressing `0` — or who had used the D-pad earlier at all — arrived with it
   * already set, and the controls they were about to tap were taken away a moment
   * later.
   */
  readonly keyDriven: boolean;
  /** What the user asked for on the Game Mode toolbar, or `null` if they have not. */
  readonly requested: JoystickVisibility | null;
  readonly videoLive: boolean;
}

/**
 * Whether the on-screen joystick is drawn in Game Mode.
 *
 * An explicit answer decides it; only `auto` consults the picture, where a guess is
 * overruled rather than leave the screen empty. Checking the picture FIRST ignored an
 * explicit `hidden`, which on the keypad handset — where that is the shipped default
 * because the device cannot operate a touch control, and Game Mode now opens by itself
 * on launch — filled the screen with a joystick nobody could touch and no picture.
 * `RemoteInputSheet` fills that space instead. S3-GAMEMODE-8020-JOYSTICK-SHOWN-WITH-NO-PICTURE.
 */
export const resolveJoystickVisibility = ({
  setting,
  keyDriven,
  requested,
  videoLive,
}: JoystickVisibilityInput): JoystickVisibility => {
  if (requested !== null) return requested;
  if (setting !== "auto") return setting;
  if (!videoLive) return "visible";
  return keyDriven ? "hidden" : "visible";
};

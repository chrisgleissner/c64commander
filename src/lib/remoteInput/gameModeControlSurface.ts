/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { InputModality } from "@/lib/input/inputModality";

/**
 * Whether the on-screen joystick and keyboard are drawn in Game Mode.
 *
 * `auto` answers from how the user is actually driving the app rather than from a
 * switch they would first have to find: a keypad handset reaches Game Mode by key
 * and never sees the controls, a tablet reaches it by tap and always does. The two
 * explicit states cover what observation cannot — a tablet played with a Bluetooth
 * controller, and a keypad handset whose owner wants the on-screen stick anyway.
 */
export type ControlsSetting = "auto" | "always" | "never";

export const CONTROLS_SETTINGS: readonly ControlsSetting[] = ["auto", "always", "never"];

export const DEFAULT_GAME_MODE_CONTROLS: ControlsSetting = "auto";

export const GAME_MODE_CONTROLS_LABEL: Record<ControlsSetting, string> = {
  auto: "Auto",
  always: "Always show",
  never: "Never show",
};

const CONTROLS_KEY = "c64u_game_mode_controls_visibility";

export const isControlsSetting = (value: unknown): value is ControlsSetting =>
  typeof value === "string" && (CONTROLS_SETTINGS as readonly string[]).includes(value);

export const loadGameModeControls = (): ControlsSetting => {
  if (typeof localStorage === "undefined") return DEFAULT_GAME_MODE_CONTROLS;
  const raw = localStorage.getItem(CONTROLS_KEY);
  return isControlsSetting(raw) ? raw : DEFAULT_GAME_MODE_CONTROLS;
};

/** Announced on every change, so a Remote Input sheet that is already mounted follows it. */
export const GAME_MODE_CONTROLS_CHANGE_EVENT = "c64u-game-mode-controls-changed";

export const saveGameModeControls = (setting: ControlsSetting): void => {
  if (typeof localStorage === "undefined") return;
  if (!isControlsSetting(setting)) return;
  localStorage.setItem(CONTROLS_KEY, setting);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GAME_MODE_CONTROLS_CHANGE_EVENT));
  }
};

export interface ControlSurfaceInput {
  readonly setting: ControlsSetting;
  readonly modality: InputModality;
  readonly videoLive: boolean;
}

/**
 * An explicit answer is honoured exactly; only `auto` is guarded.
 *
 * The never-blank guard exists because `auto` GUESSES from the modality, and a wrong guess
 * with no picture would leave an empty sheet. It does not apply to the two explicit states:
 * a user who chose **Never show** has said they are driving with physical keys, and
 * overriding that — which is what the app did — reads as the setting being broken. The sheet
 * is still not empty without them: the floating **Controls** handle is always there, and `#`
 * brings the quick keys and the Live View switches up.
 */
export const resolveControlSurface = ({ setting, modality, videoLive }: ControlSurfaceInput): "shown" | "hidden" => {
  if (setting === "always") return "shown";
  if (setting === "never") return "hidden";
  if (!videoLive) return "shown";
  return modality === "key-navigation" ? "hidden" : "shown";
};

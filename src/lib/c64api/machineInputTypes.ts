/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type MachineInputStateResponse = {
  keyboard: {
    inputs: string[];
  };
  joysticks: Array<{
    port: 1 | 2;
    inputs: string[];
  }>;
  errors: string[];
};

// HARD12-017: the u64e-openapi.yaml v3.15-alpha `machine:input` schema
// (KeyboardInput/JoystickInput enums, InputBatch/*Event shapes). U64-family +
// machine:input-capable firmware only.
export type JoystickInputName = "up" | "down" | "left" | "right" | "fire" | "fire2" | "fire3";

export type KeyboardInputName =
  | "inst_del"
  | "return"
  | "cursor_left_right"
  | "f7"
  | "f1"
  | "f3"
  | "f5"
  | "cursor_up_down"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"
  | "left_shift"
  | "right_shift"
  | "plus"
  | "minus"
  | "period"
  | "colon"
  | "at"
  | "comma"
  | "pound"
  | "star"
  | "semicolon"
  | "clr_home"
  | "equals"
  | "arrow_up"
  | "slash"
  | "arrow_left"
  | "ctrl"
  | "space"
  | "commodore"
  | "run_stop"
  | "restore";

export type MachineInputTransition = "press" | "release" | "tap";

export type MachineInputKeyboardEvent = {
  kind: "keyboard";
  inputs: KeyboardInputName[];
  transition: MachineInputTransition;
};

export type MachineInputJoystickEvent = {
  kind: "joystick";
  port: 1 | 2;
  inputs: JoystickInputName[];
  transition: MachineInputTransition;
};

export type MachineInputReleaseAllEvent = {
  kind: "release_all";
};

export type MachineInputEvent = MachineInputKeyboardEvent | MachineInputJoystickEvent | MachineInputReleaseAllEvent;

export type MachineInputBatch = {
  events: MachineInputEvent[];
};

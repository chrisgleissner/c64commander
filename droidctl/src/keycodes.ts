/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ToolValidationError } from "./tools/errors.js";

/**
 * Both forms are already in use in this repository — bare numbers in the keypad
 * harness, KEYCODE_ names in the remote-input harness — so both are accepted and
 * the table is served as a resource rather than copied into each caller.
 */
export const KEYCODES: Readonly<Record<string, number>> = {
  KEYCODE_UNKNOWN: 0,
  KEYCODE_SOFT_LEFT: 1,
  KEYCODE_SOFT_RIGHT: 2,
  KEYCODE_HOME: 3,
  KEYCODE_BACK: 4,
  KEYCODE_CALL: 5,
  KEYCODE_ENDCALL: 6,
  KEYCODE_0: 7,
  KEYCODE_1: 8,
  KEYCODE_2: 9,
  KEYCODE_3: 10,
  KEYCODE_4: 11,
  KEYCODE_5: 12,
  KEYCODE_6: 13,
  KEYCODE_7: 14,
  KEYCODE_8: 15,
  KEYCODE_9: 16,
  KEYCODE_STAR: 17,
  KEYCODE_POUND: 18,
  KEYCODE_DPAD_UP: 19,
  KEYCODE_DPAD_DOWN: 20,
  KEYCODE_DPAD_LEFT: 21,
  KEYCODE_DPAD_RIGHT: 22,
  KEYCODE_DPAD_CENTER: 23,
  KEYCODE_VOLUME_UP: 24,
  KEYCODE_VOLUME_DOWN: 25,
  KEYCODE_POWER: 26,
  KEYCODE_CAMERA: 27,
  KEYCODE_CLEAR: 28,
  KEYCODE_ENTER: 66,
  KEYCODE_DEL: 67,
  KEYCODE_TAB: 61,
  KEYCODE_SPACE: 62,
  KEYCODE_MENU: 82,
  KEYCODE_SEARCH: 84,
  KEYCODE_MEDIA_PLAY_PAUSE: 85,
  KEYCODE_MEDIA_STOP: 86,
  KEYCODE_MEDIA_NEXT: 87,
  KEYCODE_MEDIA_PREVIOUS: 88,
  KEYCODE_PAGE_UP: 92,
  KEYCODE_PAGE_DOWN: 93,
  KEYCODE_ESCAPE: 111,
  KEYCODE_FORWARD_DEL: 112,
  KEYCODE_MOVE_HOME: 122,
  KEYCODE_MOVE_END: 123,
  KEYCODE_MEDIA_PLAY: 126,
  KEYCODE_MEDIA_PAUSE: 127,
  KEYCODE_APP_SWITCH: 187,
  KEYCODE_WAKEUP: 224,
  KEYCODE_SLEEP: 223,
};

export const KEYCODE_NAMES_BY_NUMBER: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(KEYCODES).map(([name, number]) => [number, name]),
);

export function resolveKeycode(keycode: string | number): number {
  if (typeof keycode === "number") {
    if (!Number.isInteger(keycode) || keycode < 0) {
      throw new ToolValidationError(`Keycode ${keycode} is not a non-negative integer.`);
    }
    return keycode;
  }

  const trimmed = keycode.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const name = trimmed.toUpperCase();
  const withPrefix = name.startsWith("KEYCODE_") ? name : `KEYCODE_${name}`;
  const resolved = KEYCODES[withPrefix];
  if (resolved === undefined) {
    throw new ToolValidationError(
      `Unknown keycode ${JSON.stringify(keycode)}. Read droidctl://reference/keycodes for the table, or pass a number.`,
      { details: { keycode } },
    );
  }
  return resolved;
}

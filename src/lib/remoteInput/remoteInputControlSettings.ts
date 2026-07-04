/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * HARD13 remote-control ergonomics: the joystick/fire controls must be usable
 * without looking at the screen (second-screen/handheld play) and forgiving of big
 * fingers on tiny screens. The control size is a persisted user preference so a
 * chosen size survives across sessions and devices.
 */
export type RemoteInputControlSize = "M" | "L" | "XL" | "XXL";

export const REMOTE_INPUT_CONTROL_SIZES: readonly RemoteInputControlSize[] = ["M", "L", "XL", "XXL"];

// Multipliers applied to the base control geometry (stick zone, D-pad cells,
// fire button). Default is "L", one step above the original cramped "M" size,
// because the primary complaint is that the action controls are too small.
const CONTROL_SIZE_SCALE: Record<RemoteInputControlSize, number> = {
  M: 1,
  L: 1.3,
  XL: 1.65,
  XXL: 2.05,
};

export const REMOTE_INPUT_CONTROL_SIZE_LABEL: Record<RemoteInputControlSize, string> = {
  M: "M",
  L: "L",
  XL: "XL",
  XXL: "XXL",
};

export const DEFAULT_REMOTE_INPUT_CONTROL_SIZE: RemoteInputControlSize = "L";

const CONTROL_SIZE_KEY = "c64u_remote_input_control_size";

const isControlSize = (value: unknown): value is RemoteInputControlSize =>
  typeof value === "string" && (REMOTE_INPUT_CONTROL_SIZES as readonly string[]).includes(value);

export const remoteInputControlScale = (size: RemoteInputControlSize): number => CONTROL_SIZE_SCALE[size];

export const loadRemoteInputControlSize = (): RemoteInputControlSize => {
  if (typeof localStorage === "undefined") return DEFAULT_REMOTE_INPUT_CONTROL_SIZE;
  const raw = localStorage.getItem(CONTROL_SIZE_KEY);
  return isControlSize(raw) ? raw : DEFAULT_REMOTE_INPUT_CONTROL_SIZE;
};

export const saveRemoteInputControlSize = (size: RemoteInputControlSize): void => {
  if (typeof localStorage === "undefined") return;
  if (!isControlSize(size)) return;
  localStorage.setItem(CONTROL_SIZE_KEY, size);
};

/** Step the size up (+1) or down (-1), clamped to the available range. */
export const stepRemoteInputControlSize = (size: RemoteInputControlSize, direction: 1 | -1): RemoteInputControlSize => {
  const index = REMOTE_INPUT_CONTROL_SIZES.indexOf(size);
  const nextIndex = Math.min(REMOTE_INPUT_CONTROL_SIZES.length - 1, Math.max(0, index + direction));
  return REMOTE_INPUT_CONTROL_SIZES[nextIndex];
};

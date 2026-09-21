/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { mergeKeymaps, type Keymap, type KeyBinding } from "./keymap";

/**
 * Keymap override files: JSON a handset owner can edit without rebuilding the app. Each file adds
 * bindings in front of a built-in profile, so the built-in TypeScript profiles stay the tested
 * defaults and a file only has to name what differs on its handset. Parsing lives in
 * keymapOverrideSchema.ts so the startup bundle carries only this installed-state half.
 */

export type OverridableProfileId = "keypad" | "defaultKeyboard";

export interface KeymapOverrideFile {
  readonly schema: 1;
  readonly match?: { readonly manufacturer?: string; readonly model?: string };
  readonly extends: OverridableProfileId;
  readonly bindings: readonly KeyBinding[];
  readonly timing?: { readonly multiTapTimeoutMs: number };
}

export interface DeviceIdentity {
  readonly manufacturer: string;
  readonly model: string;
}

const sameName = (expected: string | undefined, actual: string) =>
  expected === undefined || expected.trim().toLowerCase() === actual.trim().toLowerCase();

/** A file with no `match` applies to every handset; otherwise each named field must match. */
export const matchesDevice = (file: KeymapOverrideFile, identity: DeviceIdentity | null): boolean => {
  if (!file.match) return true;
  if (!identity) return false;
  return sameName(file.match.manufacturer, identity.manufacturer) && sameName(file.match.model, identity.model);
};

let installed: readonly KeymapOverrideFile[] = [];
let version = 0;
const listeners = new Set<() => void>();

/** Files later in the list take precedence, so pass generic files before device-specific ones. */
export const installKeymapOverrides = (files: readonly KeymapOverrideFile[]): void => {
  installed = files;
  version += 1;
  listeners.forEach((listener) => listener());
};

export const getKeymapOverridesVersion = (): number => version;

export const subscribeKeymapOverrides = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const applyKeymapOverrides = (base: Keymap, profileId: string): Keymap =>
  installed
    .filter((file) => file.extends === profileId)
    .reduce((keymap, file) => mergeKeymaps(keymap, { bindings: file.bindings, timing: file.timing }), base);

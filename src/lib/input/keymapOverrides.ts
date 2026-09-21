/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { z } from "zod";

import { mergeKeymaps, type Keymap } from "./keymap";
import { SEMANTIC_ACTIONS, type SemanticAction } from "./keyEvent";

/**
 * Keymap override files: JSON a handset owner can edit without rebuilding the app. Each file adds
 * bindings in front of a built-in profile, so the built-in TypeScript profiles stay the tested
 * defaults and a file only has to name what differs on its handset.
 */

export const KEYMAP_OVERRIDE_SCHEMA_VERSION = 1;

const OVERRIDABLE_PROFILE_IDS = ["keypad", "defaultKeyboard"] as const;
export type OverridableProfileId = (typeof OVERRIDABLE_PROFILE_IDS)[number];

const bindingSchema = z
  .object({
    code: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    keyCode: z.number().int().positive().optional(),
    shift: z.boolean().optional(),
    alt: z.boolean().optional(),
    ctrl: z.boolean().optional(),
    action: z.enum(SEMANTIC_ACTIONS as [SemanticAction, ...SemanticAction[]]),
  })
  .strict()
  .refine((binding) => binding.code !== undefined || binding.key !== undefined || binding.keyCode !== undefined, {
    message: "a binding needs a code, key or keyCode to match",
  });

const deviceMatchSchema = z
  .object({ manufacturer: z.string().min(1).optional(), model: z.string().min(1).optional() })
  .strict();

const keymapOverrideFileSchema = z
  .object({
    schema: z.literal(KEYMAP_OVERRIDE_SCHEMA_VERSION),
    match: deviceMatchSchema.optional(),
    extends: z.enum(OVERRIDABLE_PROFILE_IDS).default("keypad"),
    bindings: z.array(bindingSchema),
    timing: z.object({ multiTapTimeoutMs: z.number().int().positive() }).strict().optional(),
  })
  .strict();

export type KeymapOverrideFile = z.infer<typeof keymapOverrideFileSchema>;

export interface DeviceIdentity {
  readonly manufacturer: string;
  readonly model: string;
}

export type ParsedKeymapOverride = { ok: true; file: KeymapOverrideFile } | { ok: false; reason: string };

export const parseKeymapOverride = (text: string): ParsedKeymapOverride => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${(error as Error).message}` };
  }
  const parsed = keymapOverrideFileSchema.safeParse(json);
  if (parsed.success) return { ok: true, file: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return { ok: false, reason: `${where}${issue.message}` };
};

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

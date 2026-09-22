/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { z } from "zod";

import { SEMANTIC_ACTIONS, type SemanticAction } from "./keyEvent";
import type { KeymapOverrideFile } from "./keymapOverrides";

export const KEYMAP_OVERRIDE_SCHEMA_VERSION = 1;

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
    extends: z.enum(["keypad", "defaultKeyboard"]).default("keypad"),
    bindings: z.array(bindingSchema),
    timing: z.object({ multiTapTimeoutMs: z.number().int().positive() }).strict().optional(),
  })
  .strict();

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

/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const JOYSTICK_KEY_BINDINGS_SOURCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "lib",
  "remoteInput",
  "joystickKeyBindings.ts",
);

/** The Settings option labels, read from the app's own `JOYSTICK_LAYOUT_LABEL` so a rename cannot drift. */
export const parseJoystickLayoutLabels = (source) => {
  const block = /JOYSTICK_LAYOUT_LABEL[^=]*=\s*\{([^}]*)\}/.exec(source);
  if (!block) throw new Error("JOYSTICK_LAYOUT_LABEL is not in joystickKeyBindings.ts any more");
  const labels = Object.fromEntries([...block[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map(([, id, label]) => [id, label]));
  if (Object.keys(labels).length === 0) throw new Error("JOYSTICK_LAYOUT_LABEL has no entries this parser can read");
  return labels;
};

export const readJoystickLayoutLabels = async (file = JOYSTICK_KEY_BINDINGS_SOURCE) =>
  parseJoystickLayoutLabels(await readFile(file, "utf8"));

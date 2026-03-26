/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const SOURCE_LABELS = {
  local: "Local",
  c64u: "C64U",
  hvsc: "HVSC",
  commoserve: "CommoServe",
  assembly64: "Assembly64",
} as const;

export const SOURCE_EXPLANATIONS = {
  local: "Local Device",
  c64u: "Commodore 64 Ultimate",
  hvsc: "High Voltage SID Collection",
  commoserve: "Online File Archive",
  assembly64: "Online Demo Archive",
} as const;

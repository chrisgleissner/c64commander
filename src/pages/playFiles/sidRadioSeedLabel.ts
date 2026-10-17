/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const readableSeedLabel = (label: string): string =>
  label
    .replace(/\.sid$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim() || label;

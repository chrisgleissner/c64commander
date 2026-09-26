/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * HVSC writes "<?>" where a title, author or release is unknown, in SID headers and in STIL alike.
 * It is a placeholder, not a name, so it is removed wherever those strings are read.
 */
const UNKNOWN_PLACEHOLDER = /<\?>/g;

export const withoutUnknownPlaceholder = (value: string): string =>
  value.includes("<?>") ? value.replace(UNKNOWN_PLACEHOLDER, " ").replace(/\s+/g, " ").trim() : value;

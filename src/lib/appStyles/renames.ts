/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { APP_STYLE_RENAMES } from "@/generated/appStyles";

/**
 * Maps a style id that a previous release persisted, printed in a document or put in a URL onto the
 * id it carries today. Unknown ids pass through unchanged so the caller's own fallback still runs.
 */
export const applyStyleRename = (styleId: string): string => APP_STYLE_RENAMES[styleId] ?? styleId;

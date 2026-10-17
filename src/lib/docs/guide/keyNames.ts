/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getKeyLabels } from "@/lib/variant/keyLabels";

/** The key that leaves, closes and goes back: a soft key on the keypad handset, Back elsewhere. */
export const backKeyName = (variantId: string): string => getKeyLabels(variantId).leftSoft;

/** The key that opens the selected item's menu, or the Quick menu where it has none. */
export const menuKeyName = (variantId: string): string => getKeyLabels(variantId).rightSoft;

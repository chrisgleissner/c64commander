/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isKeypadEdition } from "@/lib/docs/deviceNames";

/** The key that leaves, closes and goes back: a soft key on the keypad handset, Back elsewhere. */
export const backKeyName = (variantId: string): string => (isKeypadEdition(variantId) ? "Left Soft Key" : "Back key");

/** The key that opens the selected item's menu, or the Quick menu where it has none. */
export const menuKeyName = (variantId: string): string => (isKeypadEdition(variantId) ? "Right Soft Key" : "Menu key");

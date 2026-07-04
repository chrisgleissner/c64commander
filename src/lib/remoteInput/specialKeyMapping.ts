/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MachineInputKeyboardEvent } from "@/lib/c64api";

/** Keys with no ASCII/char representation, so they bypass charToKeyboardInputEvents. */
export type SpecialKeyboardKey = "run_stop" | "restore" | "f1" | "f3" | "f5" | "f7";

export const specialKeyToKeyboardInputEvent = (key: SpecialKeyboardKey): MachineInputKeyboardEvent => ({
  kind: "keyboard",
  inputs: [key],
  transition: "tap",
});

/**
 * PETSCII codes for the kernal keyboard-buffer fallback tier. RUN/STOP and
 * RESTORE have NO PETSCII byte at all — the real KERNAL keyboard scan reads
 * them directly (RESTORE even triggers a hardware NMI), bypassing the input
 * buffer entirely — so they cannot be injected this way and resolve to null.
 * F-keys DO have buffer codes and work on both tiers.
 */
const SPECIAL_KEY_PETSCII: Partial<Record<SpecialKeyboardKey, number>> = {
  f1: 0x85,
  f3: 0x86,
  f5: 0x87,
  f7: 0x88,
};

export const specialKeyToPetscii = (key: SpecialKeyboardKey): number | null => SPECIAL_KEY_PETSCII[key] ?? null;

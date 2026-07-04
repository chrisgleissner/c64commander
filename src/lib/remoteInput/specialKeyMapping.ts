/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyboardInputName, MachineInputKeyboardEvent } from "@/lib/c64api";

/**
 * Named C64 keys that have no plain single-character representation, so they
 * bypass {@link charToKeyboardInputEvents} and dispatch through their own
 * handler (`sendSpecialKey`). This is the one shared vocabulary for these keys
 * across every Type-tab keyboard profile, so a direct virtual key dispatches
 * identically no matter which layout rendered it.
 *
 * `home`/`clr`, `del`/`ins` and `f2`/`f4`/`f6`/`f8` are the ATOMIC virtual
 * split of the C64's dual-function physical keys: the real keyboard exposes
 * one physical key per pair (`clr_home`, `inst_del`, `f1`..`f7`) whose second
 * function is only reachable by holding Shift. We expose both halves as direct
 * one-tap keys and encode the shifted half as a single atomic `tap` chord
 * (base key + `left_shift`), so the operation never depends on the user first
 * latching a modifier and never leaves Shift stuck (see cursorKeyMapping for
 * the same pattern applied to the cursor keys).
 */
export type SpecialKeyboardKey =
  "run_stop" | "restore" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "home" | "clr" | "del" | "ins";

/**
 * The physical matrix key(s) each special key resolves to. Single-entry arrays
 * are ordinary keys; two-entry arrays ending in `left_shift` are the atomic
 * shifted half of a dual-function key. Because the whole chord ships as ONE
 * `tap` event, the device presses and releases both keys together — no leaked
 * or stuck Shift.
 */
const SPECIAL_KEY_INPUTS: Record<SpecialKeyboardKey, KeyboardInputName[]> = {
  run_stop: ["run_stop"],
  restore: ["restore"],
  f1: ["f1"],
  f3: ["f3"],
  f5: ["f5"],
  f7: ["f7"],
  f2: ["f1", "left_shift"],
  f4: ["f3", "left_shift"],
  f6: ["f5", "left_shift"],
  f8: ["f7", "left_shift"],
  home: ["clr_home"],
  clr: ["clr_home", "left_shift"],
  del: ["inst_del"],
  ins: ["inst_del", "left_shift"],
};

export const specialKeyToKeyboardInputEvent = (key: SpecialKeyboardKey): MachineInputKeyboardEvent => ({
  kind: "keyboard",
  inputs: SPECIAL_KEY_INPUTS[key],
  transition: "tap",
});

/**
 * PETSCII codes for the kernal keyboard-buffer fallback tier. RUN/STOP and
 * RESTORE have NO PETSCII byte at all — the real KERNAL keyboard scan reads
 * them directly (RESTORE even triggers a hardware NMI), bypassing the input
 * buffer entirely — so they cannot be injected this way and resolve to null.
 * The F-keys, HOME/CLR and DEL/INS all DO have buffer codes and work on both
 * tiers.
 */
const SPECIAL_KEY_PETSCII: Partial<Record<SpecialKeyboardKey, number>> = {
  f1: 0x85,
  f3: 0x86,
  f5: 0x87,
  f7: 0x88,
  f2: 0x89,
  f4: 0x8a,
  f6: 0x8b,
  f8: 0x8c,
  home: 0x13,
  clr: 0x93,
  del: 0x14,
  ins: 0x94,
};

export const specialKeyToPetscii = (key: SpecialKeyboardKey): number | null => SPECIAL_KEY_PETSCII[key] ?? null;

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { PETSCII_INST_DEL, PETSCII_RETURN } from "@/lib/remoteInput/cursorKeyMapping";

/**
 * Encodes text for the HARD12-008 chunked kernal keyboard-buffer injection
 * (`injectAutostart`), used as the Type-mode fallback on devices/firmware
 * without `machine:input`. PETSCII matches plain ASCII `charCodeAt` for the
 * printable range the on-screen keyboard and quick-keys bar actually send —
 * the same encoding `buildAutostartSequence` already relies on for
 * `LOAD"*",8,1`/`RUN`. Characters with no direct PETSCII byte equivalent are
 * skipped rather than guessed, matching {@link charToKeyboardInputEvents}'s
 * degrade-gracefully behaviour on the REST tier.
 */
export const stringToPetsciiBytes = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (const char of text) {
    if (char === "\n" || char === "\r") {
      bytes.push(PETSCII_RETURN);
      continue;
    }
    if (char === "\b") {
      bytes.push(PETSCII_INST_DEL);
      continue;
    }
    const rawCode = char.charCodeAt(0);
    // The C64 boots into upper/graphics charset mode, where PETSCII 0x61-0x7A
    // are graphics glyphs, not lowercase letters - normal-looking text needs
    // the uppercase byte, exactly like buildAutostartSequence's "LOAD"/"RUN".
    const code = rawCode >= 0x61 && rawCode <= 0x7a ? rawCode - 0x20 : rawCode;
    if (code >= 0x20 && code <= 0x5f) {
      bytes.push(code);
    }
  }
  return new Uint8Array(bytes);
};

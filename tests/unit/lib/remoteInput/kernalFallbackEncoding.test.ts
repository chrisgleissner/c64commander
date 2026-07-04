/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { stringToPetsciiBytes } from "@/lib/remoteInput/kernalFallbackEncoding";

describe("stringToPetsciiBytes", () => {
  it("encodes uppercase letters and digits as plain ASCII bytes", () => {
    expect(stringToPetsciiBytes("LOAD8")).toEqual(new Uint8Array([0x4c, 0x4f, 0x41, 0x44, 0x38]));
  });

  it("upshifts lowercase letters, since PETSCII 0x61-0x7A are graphics glyphs in the default charset", () => {
    expect(stringToPetsciiBytes("load")).toEqual(new Uint8Array([0x4c, 0x4f, 0x41, 0x44]));
  });

  it("maps newline/carriage-return to PETSCII RETURN", () => {
    expect(stringToPetsciiBytes("a\nb\rc")).toEqual(new Uint8Array([0x41, 0x0d, 0x42, 0x0d, 0x43]));
  });

  it("maps backspace to PETSCII INST/DEL", () => {
    expect(stringToPetsciiBytes("a\bb")).toEqual(new Uint8Array([0x41, 0x14, 0x42]));
  });

  it("skips characters with no printable-range PETSCII equivalent", () => {
    expect(stringToPetsciiBytes("a£b")).toEqual(new Uint8Array([0x41, 0x42]));
  });

  it("returns an empty array for empty input", () => {
    expect(stringToPetsciiBytes("")).toEqual(new Uint8Array([]));
  });
});

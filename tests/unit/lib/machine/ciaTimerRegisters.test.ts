/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isCiaTimerRegister } from "@/lib/machine/ciaTimerRegisters";

// CIA1 $DC00-$DCFF, CIA2 $DD00-$DDFF; each 16-byte register block mirrors
// across the page. See HARD9-067.
const CIA_BASES = [0xdc00, 0xdd00];
const MIRROR_OFFSETS = [0x00, 0x10, 0x20, 0xf0];

describe("isCiaTimerRegister", () => {
  it("returns false outside the CIA1/CIA2 page range", () => {
    expect(isCiaTimerRegister(0xdbff)).toBe(false);
    expect(isCiaTimerRegister(0xde00)).toBe(false);
    expect(isCiaTimerRegister(0x0000)).toBe(false);
  });

  for (const base of CIA_BASES) {
    for (const mirror of MIRROR_OFFSETS) {
      const pageBase = base + mirror;

      it(`skips ports/DDR ($${(pageBase + 0).toString(16)}-$${(pageBase + 3).toString(16)}) = false`, () => {
        for (let reg = 0x00; reg <= 0x03; reg += 1) {
          expect(isCiaTimerRegister(pageBase + reg)).toBe(false);
        }
      });

      it(`skips timer A/B ($${(pageBase + 4).toString(16)}-$${(pageBase + 7).toString(16)}) = true`, () => {
        for (let reg = 0x04; reg <= 0x07; reg += 1) {
          expect(isCiaTimerRegister(pageBase + reg)).toBe(true);
        }
      });

      it(`skips TOD ($${(pageBase + 8).toString(16)}-$${(pageBase + 0xb).toString(16)}) = true (HARD9-067)`, () => {
        for (let reg = 0x08; reg <= 0x0b; reg += 1) {
          expect(isCiaTimerRegister(pageBase + reg)).toBe(true);
        }
      });

      it(`does not skip the serial data register ($${(pageBase + 0xc).toString(16)}) = false`, () => {
        expect(isCiaTimerRegister(pageBase + 0x0c)).toBe(false);
      });

      it(`skips ICR ($${(pageBase + 0xd).toString(16)}) = true (HARD9-067)`, () => {
        expect(isCiaTimerRegister(pageBase + 0x0d)).toBe(true);
      });

      it(`does not skip control A/B ($${(pageBase + 0xe).toString(16)}-$${(pageBase + 0xf).toString(16)}) = false`, () => {
        expect(isCiaTimerRegister(pageBase + 0x0e)).toBe(false);
        expect(isCiaTimerRegister(pageBase + 0x0f)).toBe(false);
      });
    }
  }
});

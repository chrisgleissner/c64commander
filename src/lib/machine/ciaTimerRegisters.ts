/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The CIA timer registers ($xx04-$xx07: Timer A/B lo/hi) are the only registers
 * a snapshot restore must NOT write. The firmware's readmem returns the live
 * timer *down-counter* there, while writemem sets the timer *latch* — so writing
 * a captured counter back as the latch reprograms the CIA1 Timer A jiffy IRQ and
 * the cursor blinks faster on every consecutive restore. Every other CIA
 * register is safe and worth restoring: ports ($xx00/$xx01, including the CIA2
 * VIC-bank select), DDR, TOD, serial, ICR and control. CIA registers mirror
 * every 16 bytes through each page, so the timer registers also appear at
 * $xx14-$xx17, $xx24-$xx27, ... — match on the low nibble to cover the mirrors.
 *
 * This predicate is shared by the RAM-snapshot restore (`ramOperations.ts`) and
 * the CPU-snapshot restore (`snapshot/cpu/restoreCart.ts`); it is kept in its own
 * dependency-free module so the CPU-restore path does not pull in the REST client.
 */
const CIA_PAGES_START = 0xdc00; // CIA1 $DC00-$DCFF and CIA2 $DD00-$DDFF are contiguous
const CIA_PAGES_END_EXCLUSIVE = 0xde00;

export const isCiaTimerRegister = (address: number): boolean => {
  if (address < CIA_PAGES_START || address >= CIA_PAGES_END_EXCLUSIVE) return false;
  const register = address & 0x0f;
  return register >= 0x04 && register <= 0x07;
};

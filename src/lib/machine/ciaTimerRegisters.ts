/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Three groups of CIA registers a snapshot restore must NOT write:
 *
 * - Timer A/B lo/hi ($xx04-$xx07): the firmware's readmem returns the live
 *   timer *down-counter* there, while writemem sets the timer *latch* — so
 *   writing a captured counter back as the latch reprograms the CIA1 Timer A
 *   jiffy IRQ and the cursor blinks faster on every consecutive restore.
 * - TOD ($xx08-$xx0B, tenths/seconds/minutes/hours): on the 6526, writing the
 *   TOD hours register stops the TOD clock until a subsequent tenths write
 *   restarts it. The restore writes registers in ascending address order
 *   (tenths first, hours last), so every restore leaves both CIAs' TOD clocks
 *   halted — silently breaking any TOD-timed software.
 * - ICR ($xx0D): write-mask semantics, not a plain value - writing back a
 *   captured read value (e.g. $83) re-enables whichever interrupt sources the
 *   program had deliberately disabled, causing spurious NMIs/IRQs after
 *   restore.
 *
 * Every other CIA register is safe and worth restoring: ports ($xx00/$xx01,
 * including the CIA2 VIC-bank select), DDR, the serial data register ($xx0C),
 * and control ($xx0E/$xx0F). CIA registers mirror every 16 bytes through each
 * page, so the skipped registers also appear at $xx14-$xx17/$xx18-$xx1B/$xx1D,
 * $xx24-$xx27/..., etc. — match on the low nibble to cover the mirrors.
 *
 * This predicate is shared by the RAM-snapshot restore (`ramOperations.ts`) and
 * the CPU-snapshot restore (`snapshot/cpu/restoreCart.ts`); it is kept in its own
 * dependency-free module so the CPU-restore path does not pull in the REST client.
 * See HARD9-067.
 */
const CIA_PAGES_START = 0xdc00; // CIA1 $DC00-$DCFF and CIA2 $DD00-$DDFF are contiguous
const CIA_PAGES_END_EXCLUSIVE = 0xde00;
const CIA_ICR_REGISTER = 0x0d;

export const isCiaTimerRegister = (address: number): boolean => {
  if (address < CIA_PAGES_START || address >= CIA_PAGES_END_EXCLUSIVE) return false;
  const register = address & 0x0f;
  return (register >= 0x04 && register <= 0x0b) || register === CIA_ICR_REGISTER;
};

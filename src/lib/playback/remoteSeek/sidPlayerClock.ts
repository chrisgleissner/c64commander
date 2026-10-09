/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { InteractionIntent } from "@/lib/deviceInteraction/deviceInteractionManager";
import {
  findTimeFields,
  readClockFromRow,
  SCREEN_CELLS,
  SCREEN_COLUMNS,
  sidPlayerScreenAddress,
  tickingClockField,
  type SidPlayerClockField,
} from "./sidPlayerScreen";

export type ScreenMemoryReader = (
  address: string,
  length: number,
  options?: { __c64uBypassCooldown?: boolean; __c64uIntent?: InteractionIntent },
) => Promise<Uint8Array>;

/** Long enough for any clock to move on by a second, whatever it was showing when first read. */
const CLOCK_TICK_WAIT_MS = 1200;
const CLOCK_LOCATE_ATTEMPTS = 3;
/** readmem follows the CPU's banking, so a screen under the I/O area would read CIA registers. */
const IO_AREA = { start: 0xd000, end: 0xe000 };

const hex = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const visibleScreenAddress = async (readMemory: ScreenMemoryReader) => {
  const [dd00] = await readMemory("DD00", 1);
  const [d018] = await readMemory("D018", 1);
  return sidPlayerScreenAddress(dd00, d018);
};

const overlapsIoArea = (address: number) => address < IO_AREA.end && address + SCREEN_CELLS > IO_AREA.start;

/**
 * Find the player's clock on the screen the VIC shows: the time field that moves on by a second
 * while the tune plays. Null when the screen shows no such field, e.g. a simulated device or a
 * player that draws its time some other way.
 */
export const locateSidPlayerClock = async (
  readMemory: ScreenMemoryReader,
  isCurrent: () => boolean = () => true,
): Promise<SidPlayerClockField | null> => {
  for (let attempt = 0; attempt < CLOCK_LOCATE_ATTEMPTS && isCurrent(); attempt += 1) {
    const screen = await visibleScreenAddress(readMemory);
    if (overlapsIoArea(screen)) return null;
    const before = findTimeFields(await readMemory(hex(screen), SCREEN_CELLS), screen);
    const startedAt = Date.now();
    await sleep(CLOCK_TICK_WAIT_MS);
    if (!isCurrent()) return null;
    if ((await visibleScreenAddress(readMemory)) !== screen) continue;
    const after = findTimeFields(await readMemory(hex(screen), SCREEN_CELLS), screen);
    const clock = tickingClockField(before, after, (Date.now() - startedAt) / 1000);
    if (clock) return clock;
  }
  return null;
};

/** Seconds on the player's clock, or null when its row does not show a time there right now. */
export const readSidPlayerClock = async (
  readMemory: ScreenMemoryReader,
  clock: SidPlayerClockField,
  fast: boolean,
): Promise<number | null> =>
  readClockFromRow(
    await readMemory(hex(clock.rowAddress), SCREEN_COLUMNS, { __c64uIntent: "user", __c64uBypassCooldown: fast }),
    clock,
  );

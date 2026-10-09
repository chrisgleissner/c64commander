/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Finding and reading the Ultimate SID player's own clock in screen memory.
 *
 * The clock is the only position the device offers, and it is exact to the second: the player
 * counts it from the frames it plays. Nothing about where it is drawn is assumed. The current player
 * draws "mm:ss" at the start of row 23 and its screen moves with the tune ($0800 and $8C00 were
 * seen), but it also draws the song length in the same format, and a different player could put
 * either anywhere. So the clock is found as the time field on the VIC's screen that ticks.
 */

export const SCREEN_COLUMNS = 40;
export const SCREEN_CELLS = 1000;

/** Where the VIC reads screen memory: the CIA 2 bank bits ($DD00) and the matrix nibble of $D018. */
export const sidPlayerScreenAddress = (dd00: number, d018: number): number =>
  (3 - (dd00 & 0x03)) * 0x4000 + ((d018 >> 4) & 0x0f) * 0x400;

/** Screen codes as text, reverse video included: letters, digits and punctuation; anything else is ".". */
export const screenCodesToText = (codes: Uint8Array): string =>
  Array.from(codes, (raw) => {
    const code = raw & 0x7f;
    if (code >= 1 && code <= 26) return String.fromCharCode(code + 64);
    if (code >= 0x20 && code <= 0x3f) return String.fromCharCode(code);
    return ".";
  }).join("");

/**
 * A time field on the screen: the row it is on, the cells it spans, and when it rolls over. A field
 * may grow or shrink as it counts ("9:59" to "10:00"), so it is read back as the time field on that
 * row overlapping these cells.
 */
export type SidPlayerClockField = {
  /** The screen the VIC showed when the clock was found; a different one means the player has gone. */
  screenAddress: number;
  rowAddress: number;
  column: number;
  length: number;
  wrapSeconds: number;
};

type TimeField = SidPlayerClockField & { seconds: number };

const TIME_FIELD = /(?<!\d)(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)(?!\d)/g;
/** The current player's "mm:ss" rolls over after 99:59; a field with hours is given 100 of them. */
const MINUTES_WRAP_SECONDS = 100 * 60;
const HOURS_WRAP_SECONDS = 100 * 3600;

/** Seconds shown by `text` when it is exactly one time field, e.g. "01:05", "1:05" or "1:02:05". */
export const parseClockText = (text: string): number | null => {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)$/.exec(text);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  if (hours !== undefined && Number(minutes) > 59) return null;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
};

/** Every time field on the rows of `screen`, which starts at `screenAddress`, with the seconds each shows. */
export const findTimeFields = (screen: Uint8Array, screenAddress: number): TimeField[] => {
  const fields: TimeField[] = [];
  for (let row = 0; row * SCREEN_COLUMNS < screen.length; row += 1) {
    const text = screenCodesToText(screen.subarray(row * SCREEN_COLUMNS, (row + 1) * SCREEN_COLUMNS));
    for (const match of text.matchAll(TIME_FIELD)) {
      const seconds = parseClockText(match[0]);
      if (seconds === null) continue;
      fields.push({
        screenAddress,
        rowAddress: screenAddress + row * SCREEN_COLUMNS,
        column: match.index ?? 0,
        length: match[0].length,
        wrapSeconds: match[1] === undefined ? MINUTES_WRAP_SECONDS : HOURS_WRAP_SECONDS,
        seconds,
      });
    }
  }
  return fields;
};

const overlaps = (a: SidPlayerClockField, b: SidPlayerClockField) =>
  a.rowAddress === b.rowAddress && a.column < b.column + b.length && b.column < a.column + a.length;

/** Seconds on `clock`, read from the cells of its row, or null when no time field overlaps it there. */
export const readClockFromRow = (row: Uint8Array, clock: SidPlayerClockField): number | null =>
  findTimeFields(row.subarray(0, SCREEN_COLUMNS), clock.rowAddress).find((field) => overlaps(field, clock))?.seconds ??
  null;

/**
 * The clock among the time fields of two screens read `elapsedSeconds` apart: the field in the same
 * place that moved forward by about that much. A song length, a title or a date stays put, and a
 * countdown runs backwards. With several candidates, the one nearest the end of the screen wins,
 * which is where the current player draws its clock.
 */
export const tickingClockField = (
  before: TimeField[],
  after: TimeField[],
  elapsedSeconds: number,
): SidPlayerClockField | null => {
  const ticking = after.filter((field) => {
    const earlier = before.find((other) => overlaps(other, field));
    if (!earlier) return false;
    const gained = field.seconds - earlier.seconds;
    return gained >= 1 && gained <= Math.ceil(elapsedSeconds) + 1;
  });
  const chosen = ticking.at(-1);
  if (!chosen) return null;
  const { seconds: _seconds, ...field } = chosen;
  return field;
};

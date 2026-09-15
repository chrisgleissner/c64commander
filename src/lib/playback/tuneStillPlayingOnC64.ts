/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether the C64 still plays the SID the phone took over. Coming home, the app resets a C64 left looping that
 * tune; one somebody has since reset or used for something else must be left alone. The C64's memory is
 * compared with the tune's own bytes, and the interrupt vector tells a playing tune from a machine reset.
 */

type MemoryReader = { readMemory: (address: string, length: number) => Promise<Uint8Array> };

type Tune = { load: number; data: Uint8Array; basic: boolean };

type Stretch = { start: number; end: number };

const READ_CHUNK_BYTES = 0x1000;
const MAX_COMPARED_BYTES = 0x4000;
const MIN_COMPARED_BYTES = 64;
// 544 of 546 HVSC tunes played in VICE matched this after 60 s and 240 s; 18 of 19,251 other tunes' memory did.
const MATCHING_SHARE = 0.9;
// A playing tune or its player takes the IRQ vector; a reset puts the KERNAL's handler back.
const KERNAL_IRQ_HANDLER = 0xea31;
const SETTLE_MS = 300;

// The Ultimate reads memory as the CPU sees it, so BASIC ROM, I/O and KERNAL ROM can hide the RAM beneath.
const ALWAYS_RAM: Stretch[] = [
  { start: 0x0000, end: 0xa000 },
  { start: 0xc000, end: 0xd000 },
];

const hexAddress = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");

const parseSid = (bytes: ArrayBuffer): Tune | null => {
  const view = new Uint8Array(bytes);
  if (view.length < 0x76) return null;
  const magic = String.fromCharCode(...view.subarray(0, 4));
  if (magic !== "PSID" && magic !== "RSID") return null;
  const dataOffset = (view[6] << 8) | view[7];
  let load = (view[8] << 8) | view[9];
  let data = view.subarray(dataOffset);
  if (load === 0 && data.length >= 2) {
    load = data[0] | (data[1] << 8);
    data = data.subarray(2);
  }
  // A BASIC tune runs from the KERNAL's interrupt and keeps its variables past its own program.
  const basic = magic === "RSID" && dataOffset >= 0x7c && (view[0x77] & 0x02) !== 0;
  return { load, data, basic };
};

/** The parts of the tune that lie in memory the Ultimate can always read, up to MAX_COMPARED_BYTES. */
const comparedStretches = (load: number, length: number): Stretch[] => {
  const stretches: Stretch[] = [];
  let budget = MAX_COMPARED_BYTES;
  for (const ram of ALWAYS_RAM) {
    const start = Math.max(load, ram.start);
    const end = Math.min(load + length, ram.end, start + budget);
    if (end <= start) continue;
    stretches.push({ start, end });
    budget -= end - start;
  }
  return stretches;
};

type Read = { address: number; bytes: Uint8Array };

const readStretches = async (api: MemoryReader, stretches: Stretch[]) => {
  const reads: Read[] = [];
  for (const { start, end } of stretches) {
    for (let address = start; address < end; address += READ_CHUNK_BYTES) {
      reads.push({
        address,
        bytes: await api.readMemory(hexAddress(address), Math.min(READ_CHUNK_BYTES, end - address)),
      });
    }
  }
  return reads;
};

const unchanged = (before: Read[], after: Read[]) =>
  before.every(({ bytes }, index) => bytes.every((byte, offset) => after[index].bytes[offset] === byte));

/** True while the C64 still plays the tune, false when it no longer does, null when these bytes cannot tell. */
export const isTuneStillPlayingOnC64 = async (
  api: MemoryReader,
  sidBytes: ArrayBuffer,
  settleMs = SETTLE_MS,
): Promise<boolean | null> => {
  const tune = parseSid(sidBytes);
  if (!tune) return null;
  const stretches = comparedStretches(tune.load, tune.data.length);
  const compared = stretches.reduce((total, { start, end }) => total + end - start, 0);
  if (compared < MIN_COMPARED_BYTES) return null;
  const memory = await readStretches(api, stretches);
  let matching = 0;
  for (const { address, bytes } of memory) {
    bytes.forEach((byte, index) => {
      if (byte === tune.data[address - tune.load + index]) matching += 1;
    });
  }
  if (matching / compared < MATCHING_SHARE) return false;
  if (tune.basic) return true;
  const vector = await api.readMemory("0314", 2);
  if ((vector[0] | (vector[1] << 8)) !== KERNAL_IRQ_HANDLER) return true;
  // A tune may play from the hardware vector instead; its memory then keeps changing.
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  return !unchanged(memory, await readStretches(api, stretches));
};

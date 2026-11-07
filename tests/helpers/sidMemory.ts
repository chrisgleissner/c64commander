/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { vi } from "vitest";

const DATA_OFFSET = 0x7c;
export const PLAYER_IRQ = [0x89, 0x09];
export const KERNAL_IRQ = [0x31, 0xea];

export const buildSid = ({ magic = "PSID", load = 0x1000, length = 2000, loadInData = false, basic = false } = {}) => {
  const tune = Uint8Array.from({ length }, (_, index) => (index * 7 + 3) & 0xff);
  const body = loadInData ? Uint8Array.from([load & 0xff, load >> 8, ...tune]) : tune;
  const bytes = new Uint8Array(DATA_OFFSET + body.length);
  bytes.set(
    [...magic].map((char) => char.charCodeAt(0)),
    0,
  );
  bytes.set([0x00, 0x02, 0x00, DATA_OFFSET], 4);
  bytes.set(loadInData ? [0, 0] : [load >> 8, load & 0xff], 8);
  bytes.set([0x00, basic ? 0x02 : 0x00], 0x76);
  bytes.set(body, DATA_OFFSET);
  return { buffer: bytes.buffer, tune, load };
};

/** A C64 whose memory holds `tune` at `load`, with `changed` of its bytes different and the given IRQ vector. */
export const c64Holding = (
  { tune, load }: { tune: Uint8Array; load: number },
  { changed = 0, irq = PLAYER_IRQ } = {},
) => {
  const memory = new Uint8Array(0x10000);
  memory.set(tune.subarray(0, 0x10000 - load), load);
  for (let index = 0; index < changed; index += 1) memory[load + index * 3] ^= 0xff;
  memory.set(irq, 0x314);
  return {
    memory,
    readMemory: vi.fn(async (address: string, length: number) => {
      const start = Number.parseInt(address, 16);
      return memory.slice(start, start + length);
    }),
  };
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Pure builder for the `.crt` cartridge container (the VICE/CCS64 CRT format the
 * Ultimate firmware loads via `POST /v1/runners:run_crt`). It produces the exact
 * byte layout `src/lib/fileValidation.ts:validateCrt` (and the firmware's
 * `c64_crt.cc:check_header`) expect:
 *
 *   [0..15]   16-byte magic "C64 CARTRIDGE   "
 *   [16..19]  BE32 header length = 0x40 (64)
 *   [20..21]  BE16 format version (0x0100)
 *   [22..23]  BE16 hardware type
 *   [24]      EXROM line (0 active / 1 inactive)
 *   [25]      GAME  line (0 active / 1 inactive)
 *   [26]      hardware revision (0)
 *   [27..31]  reserved (0)
 *   [32..63]  32-byte ASCII cartridge name (NUL-padded)
 *   [64..]    one or more CHIP packets:
 *               "CHIP"  (4)
 *               BE32 total packet length (= 16 + image bytes)
 *               BE16 chip type (0 = ROM)
 *               BE16 bank number
 *               BE16 load address
 *               BE16 image size
 *               image bytes
 *
 * This module is intentionally device-agnostic: it knows nothing about CPU
 * state or snapshots. {@link buildUltimaxRestoreCrt} (restoreCart.ts) composes a
 * snapshot-specific 6502 image on top of {@link buildCrt}.
 */

export const CRT_MAGIC = "C64 CARTRIDGE   ";
export const CRT_HEADER_SIZE = 64;
export const CRT_VERSION_1_0 = 0x0100;
export const CHIP_HEADER_SIZE = 16;

/** CRT hardware "cartridge type" values relevant here. 0 = generic/normal cartridge. */
export const CRT_HW_TYPE_NORMAL = 0;

/** CHIP packet chip-type values. */
export const CHIP_TYPE_ROM = 0;
export const CHIP_TYPE_RAM = 1;
export const CHIP_TYPE_FLASH = 2;

/**
 * Cartridge control-line encoding, matching the CRT spec and the firmware:
 * the lines are **active-low**, so 0 = asserted (cartridge drives the bus),
 * 1 = de-asserted.
 *
 *  - 8 KiB autostart cart:  EXROM=0, GAME=1  → ROM visible at $8000-$9FFF
 *  - Ultimax cart:          EXROM=1, GAME=0  → ROML $8000-$9FFF + ROMH $E000-$FFFF,
 *                                              CPU resets straight through the cart's
 *                                              $FFFC vector (KERNAL not mapped)
 */
export const LINE_ASSERTED = 0;
export const LINE_DEASSERTED = 1;

export type ChipPacket = {
  /** Chip type (default {@link CHIP_TYPE_ROM}). */
  type?: number;
  /** Bank number (default 0). */
  bank?: number;
  /** Load address in the C64 address space, e.g. 0x8000. */
  loadAddress: number;
  /** ROM image bytes for this packet. */
  data: Uint8Array;
};

export type CrtOptions = {
  /** Hardware cartridge type (default {@link CRT_HW_TYPE_NORMAL}). */
  hwType?: number;
  /** EXROM line (default {@link LINE_ASSERTED}). */
  exrom?: number;
  /** GAME line (default {@link LINE_DEASSERTED}). */
  game?: number;
  /** CRT format version (default {@link CRT_VERSION_1_0}). */
  version?: number;
  /** Cartridge name, truncated/padded to 32 bytes. */
  name?: string;
  /** One or more CHIP packets. */
  chips: ChipPacket[];
};

const writeBE16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value & 0xffff, false);
const writeBE32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value >>> 0, false);

const assertByte = (name: string, value: number) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`buildCrt: ${name} must be a byte (0-255), got ${value}`);
  }
};

const assertWord = (name: string, value: number) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`buildCrt: ${name} must be a 16-bit value (0-65535), got ${value}`);
  }
};

/** Builds a `.crt` image from a header description and one or more CHIP packets. */
export const buildCrt = (options: CrtOptions): Uint8Array => {
  const {
    hwType = CRT_HW_TYPE_NORMAL,
    exrom = LINE_ASSERTED,
    game = LINE_DEASSERTED,
    version = CRT_VERSION_1_0,
    name = "",
    chips,
  } = options;

  if (!chips || chips.length === 0) {
    throw new Error("buildCrt: at least one CHIP packet is required");
  }
  assertWord("hwType", hwType);
  assertByte("exrom", exrom);
  assertByte("game", game);
  assertWord("version", version);

  const chipBytes = chips.map((chip) => {
    const { type = CHIP_TYPE_ROM, bank = 0, loadAddress, data } = chip;
    assertWord("chip.type", type);
    assertWord("chip.bank", bank);
    assertWord("chip.loadAddress", loadAddress);
    const packet = new Uint8Array(CHIP_HEADER_SIZE + data.length);
    const view = new DataView(packet.buffer);
    packet.set([0x43, 0x48, 0x49, 0x50], 0); // "CHIP"
    writeBE32(view, 4, CHIP_HEADER_SIZE + data.length);
    writeBE16(view, 8, type);
    writeBE16(view, 10, bank);
    writeBE16(view, 12, loadAddress);
    writeBE16(view, 14, data.length);
    packet.set(data, CHIP_HEADER_SIZE);
    return packet;
  });

  const totalChipSize = chipBytes.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(CRT_HEADER_SIZE + totalChipSize);
  const view = new DataView(out.buffer);

  // Magic (ASCII, exactly 16 bytes)
  for (let i = 0; i < CRT_MAGIC.length; i++) out[i] = CRT_MAGIC.charCodeAt(i);
  writeBE32(view, 16, CRT_HEADER_SIZE);
  writeBE16(view, 20, version);
  writeBE16(view, 22, hwType);
  out[24] = exrom;
  out[25] = game;
  out[26] = 0; // hardware revision
  // [27..31] reserved — already zero.

  // 32-byte name, ASCII, NUL-padded/truncated.
  const nameBytes = new TextEncoder().encode(name);
  out.set(nameBytes.subarray(0, 32), 32);

  // CHIP packets
  let offset = CRT_HEADER_SIZE;
  for (const packet of chipBytes) {
    out.set(packet, offset);
    offset += packet.length;
  }

  return out;
};

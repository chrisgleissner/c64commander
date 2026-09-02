/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A real .crt cartridge image for the simulated device.
 *
 * The app offers "CRT cartridge" as a playlist type and a launch action, and until now the
 * simulated device had nothing of the kind — so that whole branch could not be exercised at all.
 * The format is the CCS64 one every emulator and the Ultimate itself read: a 64-byte header
 * followed by CHIP packets, each with its own 16-byte header and its ROM contents.
 */

const CARTRIDGE_SIGNATURE = "C64 CARTRIDGE   ";

/**
 * Build a 16 KiB generic cartridge that banks in at $8000.
 *
 * `code` is placed at the start of the ROM, after the six bytes the KERNAL reads on reset: the cold
 * and warm start vectors and the `CBM80` signature that tells the machine a cartridge is present.
 */
export const buildCrt = ({ name, code = new Uint8Array([0x60]) }) => {
  const romSize = 0x4000;
  const rom = Buffer.alloc(romSize, 0xff);

  const entry = 0x800e; // where `code` lands, straight after the header bytes below
  rom.writeUInt16LE(entry, 0x0000); // cold start
  rom.writeUInt16LE(entry, 0x0002); // warm start
  Buffer.from("CBM80", "latin1").copy(rom, 0x0004);
  // $8009 is where a real cartridge's own code usually begins; the five bytes before `entry` are
  // left as the signature's padding so a reader that checks for CBM80 finds exactly what it expects.
  Buffer.from(code).copy(rom, entry - 0x8000);

  const header = Buffer.alloc(0x40, 0x00);
  Buffer.from(CARTRIDGE_SIGNATURE, "latin1").copy(header, 0);
  header.writeUInt32BE(0x40, 0x10); // header length
  header.writeUInt16BE(0x0100, 0x14); // format version 1.0
  header.writeUInt16BE(0, 0x16); // hardware type: generic cartridge
  header[0x18] = 0x00; // EXROM asserted
  header[0x19] = 0x01; // GAME not asserted — an 8K/16K game cartridge
  Buffer.from(name.slice(0, 32), "latin1").copy(header, 0x20);

  const chip = Buffer.alloc(0x10, 0x00);
  Buffer.from("CHIP", "latin1").copy(chip, 0);
  chip.writeUInt32BE(0x10 + romSize, 0x04); // packet length, header included
  chip.writeUInt16BE(0, 0x08); // ROM
  chip.writeUInt16BE(0, 0x0a); // bank 0
  chip.writeUInt16BE(0x8000, 0x0c); // load address
  chip.writeUInt16BE(romSize, 0x0e);

  return Buffer.concat([header, chip, rom]);
};

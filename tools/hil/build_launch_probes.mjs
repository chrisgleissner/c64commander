#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The files `launch_matrix_hil.mjs` launches, and what makes them worth launching.
 *
 * Each probe writes a four-byte signature into RAM at $C000 and stops. $C000 is chosen because it
 * is 4 KiB of RAM that neither BASIC nor the KERNAL uses, so the value survives the program ending
 * and a `machine:readmem` afterwards reads what the 6510 actually wrote. A launch that only looked
 * like it worked leaves the zeroes the harness put there.
 *
 *   PRG   a BASIC stub that SYSes to the signature writer, then returns to READY.
 *   CRT   an 8 KiB cartridge with the CBM80 signature, so the firmware's cartridge start maps it
 *         and the machine resets into it. It writes its signature and then loops: a cartridge holds
 *         the machine, which is why the harness reboots after every cartridge launch.
 *   D64   a formatted disk holding the same kind of program, so `LOAD"*",8,1` + `RUN` — what the
 *         app's disk autostart does — ends with a signature in RAM.
 *   SID   a small tune copied from the device, so the folder has one of every category the app can
 *         start and the settings file beside it covers a song too.
 *   CFG   a settings file that moves one cosmetic config item, which is how "the settings file was
 *         applied" is read back over REST.
 *
 * A second folder holds the PRG and CRT with no settings file beside them, which is how the harness
 * measures what the firmware does when there is nothing to apply.
 *
 *   node tools/hil/build_launch_probes.mjs --host c64u --usb USB2
 *
 * Building the disk needs VICE's `c1541` on PATH. Everything else is built here.
 */

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return fallback;
};

const HOST = arg("host", "c64u");
const USB = arg("usb", "USB2");
const FOLDER = arg("folder", "HilProbe");
const PASSWORD = arg("password", "pwd");
const SID_SOURCE = arg("sid", `/${USB}/barcode.sid`);

/** `LDA #byte : STA $C000+n` for each byte, so the signature is written by real instructions. */
const signatureWriter = (signature) => {
  const code = [];
  [...signature].forEach((character, index) => {
    code.push(0xa9, character.charCodeAt(0), 0x8d, index, 0xc0);
  });
  return code;
};

/** A BASIC stub of `10 SYS2061` followed by the machine code it calls at $080D. */
const buildPrg = (signature) =>
  Buffer.from([
    0x01,
    0x08,
    0x0b,
    0x08,
    0x0a,
    0x00,
    0x9e,
    0x32,
    0x30,
    0x36,
    0x31,
    0x00,
    0x00,
    0x00,
    ...signatureWriter(signature),
    0x60,
  ]);

const buildCrt = (signature) => {
  const rom = Buffer.alloc(8192);
  // Cold and warm start both point at the code, and CBM80 at $8004 is what the KERNAL looks for.
  rom.set([0x09, 0x80, 0x09, 0x80, 0xc3, 0xc2, 0xcd, 0x38, 0x30], 0);
  const code = [0x78, 0xd8, 0xa2, 0xff, 0x9a, ...signatureWriter(signature)];
  const loop = 0x8009 + code.length;
  code.push(0x4c, loop & 0xff, loop >> 8);
  rom.set(code, 0x09);

  const header = Buffer.alloc(0x40);
  header.write("C64 CARTRIDGE   ", 0, "latin1");
  header.writeUInt32BE(0x40, 16);
  header.writeUInt16BE(0x0100, 20); // format version
  header.writeUInt16BE(0x0000, 22); // hardware type: a plain cartridge
  header.writeUInt8(0x00, 24); // EXROM low
  header.writeUInt8(0x01, 25); // GAME high: 8 KiB at $8000
  header.write("HILPROBE", 32, "latin1");

  const chip = Buffer.alloc(0x10);
  chip.write("CHIP", 0, "latin1");
  chip.writeUInt32BE(0x10 + rom.length, 4);
  chip.writeUInt16BE(0x0000, 8); // ROM
  chip.writeUInt16BE(0x0000, 10); // bank 0
  chip.writeUInt16BE(0x8000, 12);
  chip.writeUInt16BE(0x2000, 14);
  return Buffer.concat([header, chip, rom]);
};

const CFG = `[User Interface Settings]\nFilename overflow squeeze=Middle\n`;

const upload = async (localPath, remotePath) => {
  await execFileAsync("curl", ["-sS", "--fail", "--max-time", "60", "-T", localPath, `ftp://${HOST}${remotePath}`]);
  console.log(`  uploaded ${remotePath}`);
};

const makeDirectory = (remotePath) =>
  execFileAsync("curl", ["-sS", "--max-time", "20", "-Q", `MKD ${remotePath}`, `ftp://${HOST}/`]).catch(
    () => undefined,
  );

const main = async () => {
  const work = join(tmpdir(), `hilprobe-${process.pid}`);
  mkdirSync(work, { recursive: true });

  const prg = join(work, "hilprobe.prg");
  const crt = join(work, "hilprobe.crt");
  const cfg = join(work, "hilprobe.cfg");
  const diskPrg = join(work, "diskprobe.prg");
  const d64 = join(work, "hilprobe.d64");
  const sid = join(work, "hilprobe.sid");

  writeFileSync(prg, buildPrg("PRG!"));
  writeFileSync(crt, buildCrt("CRT!"));
  writeFileSync(cfg, CFG);
  writeFileSync(diskPrg, buildPrg("DSK!"));

  try {
    await execFileAsync("c1541", ["-format", "hilprobe,hp", "d64", d64, "-write", diskPrg, "diskprobe"]);
  } catch (error) {
    throw new Error(`building the probe disk needs VICE's c1541 on PATH: ${error.message}`);
  }

  await execFileAsync("curl", ["-sS", "--fail", "--max-time", "60", `ftp://${HOST}${SID_SOURCE}`, "-o", sid]);

  await makeDirectory(`/${USB}/${FOLDER}`);
  await makeDirectory(`/${USB}/${FOLDER}NoCfg`);

  console.log(`uploading to ${HOST}:/${USB}/${FOLDER}`);
  for (const [local, name] of [
    [prg, "hilprobe.prg"],
    [crt, "hilprobe.crt"],
    [d64, "hilprobe.d64"],
    [sid, "hilprobe.sid"],
    [cfg, "hilprobe.cfg"],
  ]) {
    await upload(local, `/${USB}/${FOLDER}/${name}`);
  }
  // The same program and cartridge with nothing beside them, for the "applies nothing" measurement.
  for (const [local, name] of [
    [prg, "hilprobe.prg"],
    [crt, "hilprobe.crt"],
  ]) {
    await upload(local, `/${USB}/${FOLDER}NoCfg/${name}`);
  }
  console.log(`done; password header for REST is "${PASSWORD}"`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

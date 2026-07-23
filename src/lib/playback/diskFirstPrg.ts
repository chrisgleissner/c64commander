/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";
import { layoutForType, listDirectory, readChain, trimErrorTable, type DiskImageType } from "@/lib/disks/diskImage";

const TXTTAB = 0x002b;

const MAX_BASIC_SCAN_STEPS = 2000;

export type { DiskImageType };

const extractFirstPrg = (image: Uint8Array, type: DiskImageType) => {
  const layout = layoutForType(type, image.byteLength);
  const first = listDirectory(image, type).find((entry) => entry.type === "PRG");
  if (!first) {
    throw new Error("No PRG found in directory");
  }
  const trimmed = trimErrorTable(image, layout);
  const prgData = readChain(trimmed, layout, first.startTrack, first.startSector);
  if (prgData.length < 2) {
    throw new Error("Extracted PRG is too small");
  }
  return { prgData, name: first.name };
};

const toHexAddress = (value: number) => value.toString(16).toUpperCase().padStart(4, "0");

const looksLikeTokenisedBasic = (prg: Uint8Array) => {
  if (prg.length < 8) return false;
  const loadAddress = prg[0] | (prg[1] << 8);
  if (loadAddress !== 0x0801) return false;

  const data = prg.slice(2);
  let i = 0;
  let steps = 0;

  while (true) {
    steps += 1;
    // HARD12-009: when the scanner overflows the step budget the previous code
    // returned `false` and the DMA injector SYSed into the program header, even
    // though most BASIC programs with >2000 lines would have been correctly
    // classified. Treat an over-budget scan as BASIC so a tokenised-BASIC
    // program with a standard stub still RUNs. Non-BASIC content still fails
    // the structural checks below.
    if (steps > MAX_BASIC_SCAN_STEPS) return true;
    if (i + 4 > data.length) return false;
    const nextPtr = data[i] | (data[i + 1] << 8);
    const lineNo = data[i + 2] | (data[i + 3] << 8);
    if (lineNo === 0 || lineNo > 63999) return false;
    let j = i + 4;
    while (j < data.length && data[j] !== 0x00) {
      j += 1;
    }
    if (j >= data.length) return false;
    i = j + 1;
    if (nextPtr === 0) return true;
    const expectedOffset = nextPtr - 0x0801;
    if (expectedOffset < 0 || expectedOffset > data.length) return false;
    if (Math.abs(i - expectedOffset) > 2) return false;
  }
};

const setBasicPointersAndClearVars = async (api: C64API, startAddress: number, endAddressExclusive: number) => {
  if (startAddress !== 0x0801) return;
  if (endAddressExclusive < 0x0801 || endAddressExclusive > 0xfffe) {
    throw new Error(`Suspicious BASIC end address: $${endAddressExclusive.toString(16).toUpperCase()}`);
  }

  const zp = new Uint8Array([
    startAddress & 0xff,
    (startAddress >> 8) & 0xff,
    endAddressExclusive & 0xff,
    (endAddressExclusive >> 8) & 0xff,
    endAddressExclusive & 0xff,
    (endAddressExclusive >> 8) & 0xff,
    endAddressExclusive & 0xff,
    (endAddressExclusive >> 8) & 0xff,
  ]);

  await api.writeMemoryBlock(toHexAddress(TXTTAB), zp);
  await api.writeMemoryBlock(toHexAddress(endAddressExclusive), new Uint8Array([0x00, 0x00]));
};

const petsciiCommand = (command: string) => {
  const bytes = Array.from(command.toUpperCase()).map((char) => char.charCodeAt(0));
  return new Uint8Array([...bytes, 0x0d]);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dmaLoadPrg = async (api: C64API, prg: Uint8Array, retries = 5, backoffMs = 50) => {
  if (prg.length < 3) throw new Error("PRG payload is too small");
  const loadAddress = prg[0] | (prg[1] << 8);
  const payload = prg.slice(2);
  const endAddressExclusive = loadAddress + payload.length;
  if (endAddressExclusive > 0x10000) {
    throw new Error("PRG payload exceeds C64 address space");
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await api.writeMemoryBlock(toHexAddress(loadAddress), payload);
      return { loadAddress, endAddressExclusive };
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        await delay(backoffMs);
      }
    }
  }

  throw new Error(`DMA load failed after retries: ${(lastError as Error)?.message ?? "Unknown error"}`);
};

export const loadFirstDiskPrgViaDma = async (api: C64API, diskImage: Uint8Array, type: DiskImageType) => {
  const { prgData, name } = extractFirstPrg(diskImage, type);
  const { loadAddress, endAddressExclusive } = await dmaLoadPrg(api, prgData);

  const isBasic = loadAddress === 0x0801 && looksLikeTokenisedBasic(prgData);
  // HARD19-018: route the RUN/SYS autostart through the shared keyboard-buffer
  // queue so it cannot race a concurrent remote-input keystroke on $0277/$00C6.
  if (isBasic) {
    await setBasicPointersAndClearVars(api, loadAddress, endAddressExclusive);
    await enqueueKeyboardBufferInjection(api, petsciiCommand("RUN"));
  } else {
    await enqueueKeyboardBufferInjection(api, petsciiCommand(`SYS ${loadAddress}`));
  }

  return {
    name,
    loadAddress,
    endAddressExclusive,
    isBasic,
  };
};

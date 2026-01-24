import type { C64API } from '@/lib/c64api';
import { injectAutostart } from './autostart';

const SECTOR_SIZE = 256;
const FILE_TYPE_MASK = 0x07;
const PRG_TYPE = 0x02;

const TXTTAB = 0x002b;

const MAX_BASIC_SCAN_STEPS = 2000;

export type DiskImageType = 'd64' | 'd71' | 'd81';

type DiskLayout = {
  tracks: number;
  directoryTrack: number;
  directorySector: number;
  sectorsPerTrack: (track: number) => number;
  totalSectors: number;
  hasErrorTable: boolean;
};

const sectorsPerTrack1541 = (track: number) => {
  if (track <= 17) return 21;
  if (track <= 24) return 19;
  if (track <= 30) return 18;
  return 17;
};

const sectorsPerTrack1571 = (track: number) => {
  const localTrack = ((track - 1) % 35) + 1;
  return sectorsPerTrack1541(localTrack);
};

const sectorsPerTrack1581 = () => 40;

const layoutForType = (type: DiskImageType, fileSize: number): DiskLayout => {
  if (type === 'd64') {
    for (const tracks of [35, 40]) {
      const baseSectors = Array.from({ length: tracks }, (_, idx) => sectorsPerTrack1541(idx + 1))
        .reduce((sum, value) => sum + value, 0);
      const baseSize = baseSectors * SECTOR_SIZE;
      const errorSize = baseSize + baseSectors;
      if (fileSize === baseSize) {
        return {
          tracks,
          directoryTrack: 18,
          directorySector: 1,
          sectorsPerTrack: sectorsPerTrack1541,
          totalSectors: baseSectors,
          hasErrorTable: false,
        };
      }
      if (fileSize === errorSize) {
        return {
          tracks,
          directoryTrack: 18,
          directorySector: 1,
          sectorsPerTrack: sectorsPerTrack1541,
          totalSectors: baseSectors,
          hasErrorTable: true,
        };
      }
    }
    throw new Error(`Unsupported D64 size: ${fileSize} bytes`);
  }

  if (type === 'd71') {
    const tracks = 70;
    const baseSectors = Array.from({ length: tracks }, (_, idx) => sectorsPerTrack1571(idx + 1))
      .reduce((sum, value) => sum + value, 0);
    const baseSize = baseSectors * SECTOR_SIZE;
    const errorSize = baseSize + baseSectors;
    if (fileSize === baseSize) {
      return {
        tracks,
        directoryTrack: 18,
        directorySector: 1,
        sectorsPerTrack: sectorsPerTrack1571,
        totalSectors: baseSectors,
        hasErrorTable: false,
      };
    }
    if (fileSize === errorSize) {
      return {
        tracks,
        directoryTrack: 18,
        directorySector: 1,
        sectorsPerTrack: sectorsPerTrack1571,
        totalSectors: baseSectors,
        hasErrorTable: true,
      };
    }
    throw new Error(`Unsupported D71 size: ${fileSize} bytes`);
  }

  if (type === 'd81') {
    const baseSectors = 80 * 40;
    const baseSize = baseSectors * SECTOR_SIZE;
    const errorSize = baseSize + baseSectors;
    if (fileSize === baseSize) {
      return {
        tracks: 80,
        directoryTrack: 40,
        directorySector: 3,
        sectorsPerTrack: sectorsPerTrack1581,
        totalSectors: baseSectors,
        hasErrorTable: false,
      };
    }
    if (fileSize === errorSize) {
      return {
        tracks: 80,
        directoryTrack: 40,
        directorySector: 3,
        sectorsPerTrack: sectorsPerTrack1581,
        totalSectors: baseSectors,
        hasErrorTable: true,
      };
    }
    throw new Error(`Unsupported D81 size: ${fileSize} bytes`);
  }

  throw new Error(`Unsupported disk type: ${type}`);
};

const tsOffset = (layout: DiskLayout, track: number, sector: number) => {
  if (track < 1 || track > layout.tracks) {
    throw new Error(`Track out of range: ${track}`);
  }
  const maxSector = layout.sectorsPerTrack(track);
  if (sector < 0 || sector >= maxSector) {
    throw new Error(`Sector out of range: track ${track} sector ${sector}`);
  }
  let offsetSectors = 0;
  for (let t = 1; t < track; t += 1) {
    offsetSectors += layout.sectorsPerTrack(t);
  }
  return (offsetSectors + sector) * SECTOR_SIZE;
};

const readSector = (image: Uint8Array, layout: DiskLayout, track: number, sector: number) => {
  const offset = tsOffset(layout, track, sector);
  const slice = image.slice(offset, offset + SECTOR_SIZE);
  if (slice.length !== SECTOR_SIZE) {
    throw new Error(`Short sector read at track ${track} sector ${sector}`);
  }
  return slice;
};

const decodeDirName = (entryName: Uint8Array) =>
  String.fromCharCode(...Array.from(entryName))
    .replace(/\u00a0/g, ' ')
    .trim();

const isPrgDirEntry = (entry: Uint8Array) => {
  if (entry.length !== 32) return false;
  const fileType = entry[0];
  const startTrack = entry[1];
  if (fileType === 0 || startTrack === 0) return false;
  return (fileType & FILE_TYPE_MASK) === PRG_TYPE;
};

const findFirstPrg = (image: Uint8Array, layout: DiskLayout) => {
  let track = layout.directoryTrack;
  let sector = layout.directorySector;
  const visited = new Set<string>();

  while (track !== 0) {
    const key = `${track}:${sector}`;
    if (visited.has(key)) break;
    visited.add(key);

    const sectorData = readSector(image, layout, track, sector);
    const nextTrack = sectorData[0];
    const nextSector = sectorData[1];

    for (let i = 0; i < 8; i += 1) {
      const offset = 2 + i * 32;
      const entry = sectorData.slice(offset, offset + 32);
      if (!isPrgDirEntry(entry)) continue;
      const name = decodeDirName(entry.slice(3, 19));
      return { track: entry[1], sector: entry[2], name };
    }

    track = nextTrack;
    sector = nextSector;
  }

  throw new Error('No PRG found in directory');
};

const readPrgChain = (image: Uint8Array, layout: DiskLayout, startTrack: number, startSector: number) => {
  const out: number[] = [];
  let track = startTrack;
  let sector = startSector;
  const visited = new Set<string>();

  while (track !== 0) {
    const key = `${track}:${sector}`;
    if (visited.has(key)) throw new Error('Loop detected while reading PRG sectors');
    visited.add(key);

    const sectorData = readSector(image, layout, track, sector);
    const nextTrack = sectorData[0];
    const nextSector = sectorData[1];

    if (nextTrack === 0) {
      let used = nextSector;
      if (used < 1 || used > 254) used = 254;
      out.push(...sectorData.slice(2, 2 + used));
      break;
    }

    out.push(...sectorData.slice(2));
    track = nextTrack;
    sector = nextSector;
  }

  return new Uint8Array(out);
};

const extractFirstPrg = (image: Uint8Array, layout: DiskLayout) => {
  const trimmed = layout.hasErrorTable
    ? image.slice(0, layout.totalSectors * SECTOR_SIZE)
    : image;
  const first = findFirstPrg(trimmed, layout);
  const prgData = readPrgChain(trimmed, layout, first.track, first.sector);
  if (prgData.length < 2) {
    throw new Error('Extracted PRG is too small');
  }
  return { prgData, name: first.name };
};

const toHexAddress = (value: number) => value.toString(16).toUpperCase().padStart(4, '0');

const looksLikeTokenisedBasic = (prg: Uint8Array) => {
  if (prg.length < 8) return false;
  const loadAddress = prg[0] | (prg[1] << 8);
  if (loadAddress !== 0x0801) return false;

  const data = prg.slice(2);
  let i = 0;
  let steps = 0;

  while (true) {
    steps += 1;
    if (steps > MAX_BASIC_SCAN_STEPS) return false;
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

const setBasicPointersAndClearVars = async (
  api: C64API,
  startAddress: number,
  endAddressExclusive: number,
) => {
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

const dmaLoadPrg = async (
  api: C64API,
  prg: Uint8Array,
  retries = 5,
  backoffMs = 50,
) => {
  if (prg.length < 3) throw new Error('PRG payload is too small');
  const loadAddress = prg[0] | (prg[1] << 8);
  const payload = prg.slice(2);
  const endAddressExclusive = loadAddress + payload.length;
  if (endAddressExclusive > 0x10000) {
    throw new Error('PRG payload exceeds C64 address space');
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

  throw new Error(`DMA load failed after retries: ${(lastError as Error)?.message ?? 'Unknown error'}`);
};

export const loadFirstDiskPrgViaDma = async (
  api: C64API,
  diskImage: Uint8Array,
  type: DiskImageType,
) => {
  const layout = layoutForType(type, diskImage.byteLength);
  const { prgData, name } = extractFirstPrg(diskImage, layout);
  const { loadAddress, endAddressExclusive } = await dmaLoadPrg(api, prgData);

  const isBasic = loadAddress === 0x0801 && looksLikeTokenisedBasic(prgData);
  if (isBasic) {
    await setBasicPointersAndClearVars(api, loadAddress, endAddressExclusive);
    await injectAutostart(api, petsciiCommand('RUN'));
  } else {
    await injectAutostart(api, petsciiCommand(`SYS ${loadAddress}`));
  }

  return {
    name,
    loadAddress,
    endAddressExclusive,
    isBasic,
  };
};

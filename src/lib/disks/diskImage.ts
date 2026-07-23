/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability A — disk image primitives.
 *
 * Side-effect-free geometry + sector/chain/directory readers, refactored out of
 * `diskFirstPrg.ts` so both the first-PRG autostart path and the Disk Explorer
 * (browse-and-launch-any-file) path share ONE parser. `diskFirstPrg.ts` delegates
 * to these, so its hardware-proven behaviour and tests are unchanged.
 *
 * As-built deviation from docs/plans/content-explorer/01-disk-explorer.md §3:
 * the plan proposed reinterpreting the final-sector byte-count rule
 * (`slice(2, byte1 + 1)`). We deliberately keep the currently-shipping,
 * hardware-proven extraction (byte1 = used-byte count, byte1 == 0 => full 254-byte
 * sector) because the proposed rule contradicts the proven first-PRG launch path
 * and its 31 passing tests (esp. the `byte1 == 0` full-sector guard), while the
 * practical difference is at most a single trailing pad byte. Extraction stays
 * consistent across the whole app.
 */

const SECTOR_SIZE = 256;
const FILE_TYPE_MASK = 0x07;
const FILE_TYPE_CLOSED = 0x80;
const FILE_TYPE_LOCKED = 0x40;
const PRG_TYPE = 0x02;
const DIR_ENTRY_SIZE = 32;
const DIR_ENTRIES_PER_SECTOR = 8;
const MAX_CHAIN_BYTES = 2 * 1024 * 1024;

export type DiskImageType = "d64" | "d71" | "d81";
export type C64FileType = "DEL" | "SEQ" | "PRG" | "USR" | "REL" | "CBM" | "UNKNOWN";

const FILE_TYPE_BY_CODE: Record<number, C64FileType> = {
  0: "DEL",
  1: "SEQ",
  2: "PRG",
  3: "USR",
  4: "REL",
  5: "CBM",
};

export interface DiskLayout {
  tracks: number;
  directoryTrack: number;
  directorySector: number;
  sectorsPerTrack: (track: number) => number;
  totalSectors: number;
  hasErrorTable: boolean;
}

export interface DiskDirectoryEntry {
  /** Stable position in the returned array — used by the UI and the disk-file play plan. */
  index: number;
  /** Decoded, trimmed display name. Best-effort for shifted/graphic characters. */
  name: string;
  /** The 16 name bytes exactly as stored, for exact LOAD re-encoding (Mount & Load). */
  rawName: Uint8Array;
  type: C64FileType;
  /** Bit 7 of the type byte — a cleared bit means an improperly-closed ("splat") file. */
  closed: boolean;
  /** Bit 6 of the type byte. */
  locked: boolean;
  startTrack: number;
  startSector: number;
  /** Block count (u16 LE from window +30/+31). */
  blocks: number;
  /** First two bytes of the file's first data sector (LE) — only for closed PRGs. */
  loadAddress?: number;
}

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

export const layoutForType = (type: DiskImageType, fileSize: number): DiskLayout => {
  if (type === "d64") {
    for (const tracks of [35, 40]) {
      const baseSectors = Array.from({ length: tracks }, (_, idx) => sectorsPerTrack1541(idx + 1)).reduce(
        (sum, value) => sum + value,
        0,
      );
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

  if (type === "d71") {
    const tracks = 70;
    const baseSectors = Array.from({ length: tracks }, (_, idx) => sectorsPerTrack1571(idx + 1)).reduce(
      (sum, value) => sum + value,
      0,
    );
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

  if (type === "d81") {
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

export const readSector = (image: Uint8Array, layout: DiskLayout, track: number, sector: number) => {
  const offset = tsOffset(layout, track, sector);
  const slice = image.slice(offset, offset + SECTOR_SIZE);
  if (slice.length !== SECTOR_SIZE) {
    throw new Error(`Short sector read at track ${track} sector ${sector}`);
  }
  return slice;
};

/** Drop a trailing error table (if present) so sector math sees only the data area. */
export const trimErrorTable = (image: Uint8Array, layout: DiskLayout) =>
  layout.hasErrorTable ? image.slice(0, layout.totalSectors * SECTOR_SIZE) : image;

/**
 * Follow a file's sector chain to its bytes. Preserves the proven `diskFirstPrg`
 * semantics exactly: for a non-final sector emit the 254 data bytes; for the final
 * sector (nextTrack == 0) emit `nextSector` data bytes, treating an out-of-range
 * count (< 1 or > 254) as a full 254-byte sector. Guards a cyclic chain and bounds
 * a malformed one.
 */
export const readChain = (image: Uint8Array, layout: DiskLayout, startTrack: number, startSector: number) => {
  const out: number[] = [];
  let track = startTrack;
  let sector = startSector;
  const visited = new Set<string>();

  while (track !== 0) {
    const key = `${track}:${sector}`;
    if (visited.has(key)) throw new Error("Loop detected while reading PRG sectors");
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

    if (out.length > MAX_CHAIN_BYTES) throw new Error("Sector chain exceeds maximum size");
  }

  return new Uint8Array(out);
};

const decodeDirName = (entryName: Uint8Array) => {
  // CBM names are padded to 16 bytes with 0xA0; some tools use 0x00. Trim trailing
  // padding, then map any interior 0xA0 to a space. Best-effort for graphic chars.
  let end = entryName.length;
  while (end > 0 && (entryName[end - 1] === 0xa0 || entryName[end - 1] === 0x00)) end -= 1;
  let out = "";
  for (let i = 0; i < end; i += 1) {
    const byte = entryName[i];
    out += byte === 0xa0 ? " " : String.fromCharCode(byte);
  }
  return out.replace(/\s+$/u, "");
};

const decodeFileType = (typeByte: number): C64FileType => FILE_TYPE_BY_CODE[typeByte & FILE_TYPE_MASK] ?? "UNKNOWN";

/**
 * List every directory entry in an image, reading all EIGHT 32-byte windows per
 * directory sector (the legacy `2 + i*32` slice silently dropped the 8th entry).
 * Empty slots (type byte 0 or start track 0) are skipped. For a closed PRG, the
 * load address is read from the first data sector (best-effort — a bad start T/S
 * leaves it undefined rather than throwing, so a single corrupt entry can't break
 * the whole listing).
 */
export const listDirectory = (image: Uint8Array, type: DiskImageType): DiskDirectoryEntry[] => {
  const layout = layoutForType(type, image.byteLength);
  const trimmed = trimErrorTable(image, layout);

  const entries: DiskDirectoryEntry[] = [];
  let track = layout.directoryTrack;
  let sector = layout.directorySector;
  const visited = new Set<string>();

  while (track !== 0) {
    const key = `${track}:${sector}`;
    if (visited.has(key)) break;
    visited.add(key);

    const sectorData = readSector(trimmed, layout, track, sector);
    const nextTrack = sectorData[0];
    const nextSector = sectorData[1];

    for (let i = 0; i < DIR_ENTRIES_PER_SECTOR; i += 1) {
      const base = i * DIR_ENTRY_SIZE;
      const window = sectorData.slice(base, base + DIR_ENTRY_SIZE);
      const typeByte = window[2];
      const startTrack = window[3];
      const startSector = window[4];
      if (typeByte === 0 || startTrack === 0) continue;

      const fileType = decodeFileType(typeByte);
      const closed = (typeByte & FILE_TYPE_CLOSED) !== 0;
      const rawName = window.slice(5, 21);

      let loadAddress: number | undefined;
      if (closed && (typeByte & FILE_TYPE_MASK) === PRG_TYPE) {
        try {
          const firstSector = readSector(trimmed, layout, startTrack, startSector);
          loadAddress = firstSector[2] | (firstSector[3] << 8);
        } catch {
          loadAddress = undefined;
        }
      }

      entries.push({
        index: entries.length,
        name: decodeDirName(rawName),
        rawName,
        type: fileType,
        closed,
        locked: (typeByte & FILE_TYPE_LOCKED) !== 0,
        startTrack,
        startSector,
        blocks: window[30] | (window[31] << 8),
        loadAddress,
      });
    }

    track = nextTrack;
    sector = nextSector;
  }

  return entries;
};

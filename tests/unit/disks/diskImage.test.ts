/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  layoutForType,
  listDirectory,
  readChain,
  readSector,
  trimErrorTable,
  type DiskImageType,
} from "@/lib/disks/diskImage";

const SECTOR = 256;

const sectorsPerTrack1541 = (track: number) => {
  if (track <= 17) return 21;
  if (track <= 24) return 19;
  if (track <= 30) return 18;
  return 17;
};

const totalSectors1541 = (tracks: number) => {
  let total = 0;
  for (let t = 1; t <= tracks; t += 1) total += sectorsPerTrack1541(t);
  return total;
};

const tsOffset = (track: number, sector: number) => {
  let offset = 0;
  for (let t = 1; t < track; t += 1) offset += sectorsPerTrack1541(t);
  return (offset + sector) * SECTOR;
};

type EntrySpec = {
  slot: number;
  typeByte: number;
  startTrack: number;
  startSector: number;
  name: string;
  blocks?: number;
};

const writeDirEntry = (image: Uint8Array, dirTrack: number, dirSector: number, spec: EntrySpec) => {
  const dirOffset = tsOffset(dirTrack, dirSector);
  const base = dirOffset + spec.slot * 32;
  image[base + 2] = spec.typeByte;
  image[base + 3] = spec.startTrack;
  image[base + 4] = spec.startSector;
  const nameBytes = new TextEncoder().encode(spec.name);
  for (let i = 0; i < 16; i += 1) {
    image[base + 5 + i] = nameBytes[i] ?? 0xa0;
  }
  const blocks = spec.blocks ?? 0;
  image[base + 30] = blocks & 0xff;
  image[base + 31] = (blocks >> 8) & 0xff;
};

const writeFinalSector = (image: Uint8Array, track: number, sector: number, data: Uint8Array) => {
  const offset = tsOffset(track, sector);
  image[offset] = 0;
  image[offset + 1] = Math.max(1, Math.min(254, data.length));
  image.set(data, offset + 2);
};

const makeD64 = (tracks = 35) => new Uint8Array(totalSectors1541(tracks) * SECTOR);

const PRG_CLOSED = 0x82; // closed + PRG

describe("diskImage — listDirectory", () => {
  it("reads ALL eight entries in a full directory sector (regression on the dropped 8th slot)", () => {
    const image = makeD64();
    for (let slot = 0; slot < 8; slot += 1) {
      writeDirEntry(image, 18, 1, {
        slot,
        typeByte: PRG_CLOSED,
        startTrack: 1,
        startSector: slot,
        name: `PRG${slot}`,
        blocks: slot + 1,
      });
      // give each a first sector so loadAddress can be read
      writeFinalSector(image, 1, slot, new Uint8Array([0x01, 0x08, 0xaa]));
    }
    const entries = listDirectory(image, "d64");
    expect(entries).toHaveLength(8);
    expect(entries.map((e) => e.name)).toEqual(["PRG0", "PRG1", "PRG2", "PRG3", "PRG4", "PRG5", "PRG6", "PRG7"]);
    expect(entries.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(entries[7].blocks).toBe(8);
    expect(entries[0].loadAddress).toBe(0x0801);
  });

  it("decodes every file type and the closed/locked flags", () => {
    const image = makeD64();
    const specs: Array<[number, string]> = [
      [0x80, "DEL"], // closed DEL
      [0x81, "SEQ"],
      [0x82, "PRG"],
      [0x83, "USR"],
      [0x84, "REL"],
      [0x85, "CBM"],
      [0x86, "UNKNOWN"], // type code 6
      [0xc2, "PRG"], // closed + locked PRG
    ];
    specs.forEach(([typeByte, _label], slot) => {
      writeDirEntry(image, 18, 1, { slot, typeByte, startTrack: 2, startSector: slot, name: `F${slot}` });
    });
    const entries = listDirectory(image, "d64");
    expect(entries.map((e) => e.type)).toEqual(specs.map(([, label]) => label));
    expect(entries[0].closed).toBe(true);
    expect(entries[7].locked).toBe(true);
    expect(entries[7].closed).toBe(true);
  });

  it("skips empty slots (type byte 0 or start track 0)", () => {
    const image = makeD64();
    writeDirEntry(image, 18, 1, { slot: 0, typeByte: PRG_CLOSED, startTrack: 1, startSector: 0, name: "REAL" });
    writeFinalSector(image, 1, 0, new Uint8Array([0x00, 0x10, 0x01]));
    writeDirEntry(image, 18, 1, { slot: 1, typeByte: 0x00, startTrack: 3, startSector: 0, name: "EMPTYTYPE" });
    writeDirEntry(image, 18, 1, { slot: 2, typeByte: PRG_CLOSED, startTrack: 0, startSector: 0, name: "ZEROTRACK" });
    const entries = listDirectory(image, "d64");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("REAL");
    expect(entries[0].loadAddress).toBe(0x1000);
  });

  it("does not read a load address for non-PRG or splat entries", () => {
    const image = makeD64();
    writeDirEntry(image, 18, 1, { slot: 0, typeByte: 0x81, startTrack: 1, startSector: 0, name: "SEQFILE" }); // SEQ
    writeDirEntry(image, 18, 1, { slot: 1, typeByte: 0x02, startTrack: 1, startSector: 1, name: "SPLAT" }); // open PRG
    writeFinalSector(image, 1, 0, new Uint8Array([0x01, 0x08, 0xaa]));
    writeFinalSector(image, 1, 1, new Uint8Array([0x01, 0x08, 0xaa]));
    const entries = listDirectory(image, "d64");
    expect(entries[0].loadAddress).toBeUndefined();
    expect(entries[1].closed).toBe(false);
    expect(entries[1].loadAddress).toBeUndefined();
  });

  it("leaves loadAddress undefined when a closed PRG points at an out-of-range sector", () => {
    const image = makeD64();
    writeDirEntry(image, 18, 1, { slot: 0, typeByte: PRG_CLOSED, startTrack: 1, startSector: 99, name: "BADPTR" });
    const entries = listDirectory(image, "d64");
    expect(entries).toHaveLength(1);
    expect(entries[0].loadAddress).toBeUndefined();
    expect(entries[0].startSector).toBe(99);
  });

  it("follows a multi-sector directory chain", () => {
    const image = makeD64();
    // first dir sector 18/1 links to 18/4
    const dir0 = tsOffset(18, 1);
    image[dir0] = 18;
    image[dir0 + 1] = 4;
    writeDirEntry(image, 18, 1, { slot: 0, typeByte: PRG_CLOSED, startTrack: 5, startSector: 0, name: "ONE" });
    writeDirEntry(image, 18, 4, { slot: 0, typeByte: PRG_CLOSED, startTrack: 5, startSector: 1, name: "TWO" });
    const entries = listDirectory(image, "d64");
    expect(entries.map((e) => e.name)).toEqual(["ONE", "TWO"]);
  });

  it("breaks a cyclic directory chain instead of looping forever", () => {
    const image = makeD64();
    const dir0 = tsOffset(18, 1);
    image[dir0] = 18; // point back to itself
    image[dir0 + 1] = 1;
    writeDirEntry(image, 18, 1, { slot: 0, typeByte: PRG_CLOSED, startTrack: 5, startSector: 0, name: "SELF" });
    const entries = listDirectory(image, "d64");
    expect(entries.map((e) => e.name)).toEqual(["SELF"]);
  });

  it("preserves rawName bytes exactly (16 bytes with 0xA0 padding)", () => {
    const image = makeD64();
    writeDirEntry(image, 18, 1, { slot: 0, typeByte: PRG_CLOSED, startTrack: 1, startSector: 0, name: "ABC" });
    const entries = listDirectory(image, "d64");
    expect(entries[0].rawName).toHaveLength(16);
    expect(Array.from(entries[0].rawName.slice(0, 3))).toEqual([65, 66, 67]);
    expect(entries[0].rawName[3]).toBe(0xa0);
  });

  it("works on a D64 image that carries an error table", () => {
    const tracks = 35;
    const base = makeD64(tracks);
    writeDirEntry(base, 18, 1, { slot: 0, typeByte: PRG_CLOSED, startTrack: 1, startSector: 0, name: "ERRTBL" });
    const withError = new Uint8Array(base.length + totalSectors1541(tracks));
    withError.set(base, 0);
    const entries = listDirectory(withError, "d64");
    expect(entries.map((e) => e.name)).toEqual(["ERRTBL"]);
  });
});

describe("diskImage — readChain / readSector / trimErrorTable", () => {
  const layout = layoutForType("d64", totalSectors1541(35) * SECTOR);

  it("reads a single final sector's used bytes", () => {
    const image = makeD64();
    writeFinalSector(image, 1, 0, new Uint8Array([0x01, 0x08, 0xde, 0xad]));
    const bytes = readChain(image, layout, 1, 0);
    expect(Array.from(bytes)).toEqual([0x01, 0x08, 0xde, 0xad]);
  });

  it("treats an out-of-range used count as a full 254-byte sector", () => {
    const image = makeD64();
    const offset = tsOffset(1, 0);
    image[offset] = 0;
    image[offset + 1] = 0; // used=0 -> full sector
    image.fill(0x55, offset + 2, offset + SECTOR);
    const bytes = readChain(image, layout, 1, 0);
    expect(bytes).toHaveLength(254);
  });

  it("follows a chain across sectors", () => {
    const image = makeD64();
    const o0 = tsOffset(1, 0);
    image[o0] = 1;
    image[o0 + 1] = 1;
    image.fill(0x11, o0 + 2, o0 + SECTOR);
    writeFinalSector(image, 1, 1, new Uint8Array([0x22, 0x22]));
    const bytes = readChain(image, layout, 1, 0);
    expect(bytes).toHaveLength(254 + 2);
    expect(bytes[0]).toBe(0x11);
    expect(bytes[254]).toBe(0x22);
  });

  it("throws on a cyclic file sector chain", () => {
    const image = makeD64();
    const o0 = tsOffset(1, 0);
    image[o0] = 1;
    image[o0 + 1] = 0; // points to itself
    expect(() => readChain(image, layout, 1, 0)).toThrow("Loop detected while reading PRG sectors");
  });

  it("readSector rejects out-of-range track and sector", () => {
    const image = makeD64();
    expect(() => readSector(image, layout, 36, 0)).toThrow("Track out of range");
    expect(() => readSector(image, layout, 1, 21)).toThrow("Sector out of range");
  });

  it("trimErrorTable is a no-op without an error table and trims with one", () => {
    const base = makeD64();
    const noTable = layoutForType("d64", base.length);
    expect(trimErrorTable(base, noTable)).toBe(base);
    const withError = new Uint8Array(base.length + totalSectors1541(35));
    const errLayout = layoutForType("d64", withError.length);
    expect(trimErrorTable(withError, errLayout)).toHaveLength(base.length);
  });
});

describe("diskImage — layoutForType", () => {
  it.each<[DiskImageType, number]>([
    ["d64", totalSectors1541(35) * SECTOR],
    ["d71", 0], // computed below
    ["d81", 80 * 40 * SECTOR],
  ])("resolves %s geometry", (type, size) => {
    if (type === "d71") {
      let total = 0;
      for (let t = 1; t <= 70; t += 1) total += sectorsPerTrack1541(((t - 1) % 35) + 1);
      const layout = layoutForType("d71", total * SECTOR);
      expect(layout.directoryTrack).toBe(18);
      return;
    }
    const layout = layoutForType(type, size);
    expect(layout.hasErrorTable).toBe(false);
    expect(layout.totalSectors).toBeGreaterThan(0);
  });

  it("throws on unsupported sizes and types", () => {
    expect(() => layoutForType("d64", 1234)).toThrow("Unsupported D64 size");
    expect(() => layoutForType("d71", 1234)).toThrow("Unsupported D71 size");
    expect(() => layoutForType("d81", 1234)).toThrow("Unsupported D81 size");
    expect(() => layoutForType("xyz" as DiskImageType, 1000)).toThrow("Unsupported disk type");
  });

  it("resolves d71/d81 base and error-table geometry", () => {
    let d71 = 0;
    for (let t = 1; t <= 70; t += 1) d71 += sectorsPerTrack1541(((t - 1) % 35) + 1);
    const d71Base = layoutForType("d71", d71 * SECTOR);
    expect(d71Base.hasErrorTable).toBe(false);
    const d71Err = layoutForType("d71", d71 * SECTOR + d71);
    expect(d71Err.hasErrorTable).toBe(true);
    expect(d71Err.directoryTrack).toBe(18);

    const d81 = 80 * 40;
    const d81Base = layoutForType("d81", d81 * SECTOR);
    expect(d81Base.directoryTrack).toBe(40);
    expect(d81Base.directorySector).toBe(3);
    const d81Err = layoutForType("d81", d81 * SECTOR + d81);
    expect(d81Err.hasErrorTable).toBe(true);
  });

  it("40-track D64 base and error-table geometry", () => {
    const base = totalSectors1541(40) * SECTOR;
    expect(layoutForType("d64", base).tracks).toBe(40);
    expect(layoutForType("d64", base + totalSectors1541(40)).hasErrorTable).toBe(true);
  });
});

describe("diskImage — readSector short-read guard", () => {
  it("throws when the image is truncated below a valid sector offset", () => {
    const layout = layoutForType("d64", totalSectors1541(35) * SECTOR);
    expect(() => readSector(new Uint8Array(0), layout, 1, 0)).toThrow("Short sector read");
  });
});

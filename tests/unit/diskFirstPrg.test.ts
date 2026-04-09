/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadFirstDiskPrgViaDma } from "@/lib/playback/diskFirstPrg";
import { injectAutostart } from "@/lib/playback/autostart";

type ApiMock = {
  writeMemoryBlock: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/playback/autostart", () => ({
  injectAutostart: vi.fn(),
}));

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

const totalSectors1541 = (tracks: number) => {
  let total = 0;
  for (let t = 1; t <= tracks; t += 1) {
    total += sectorsPerTrack1541(t);
  }
  return total;
};

const tsOffset = (track: number, sector: number) => {
  let offset = 0;
  for (let t = 1; t < track; t += 1) {
    offset += sectorsPerTrack1541(t);
  }
  return (offset + sector) * 256;
};

const tsOffsetGeneric = (sectorsPerTrack: (track: number) => number, track: number, sector: number) => {
  let offset = 0;
  for (let t = 1; t < track; t += 1) {
    offset += sectorsPerTrack(t);
  }
  return (offset + sector) * 256;
};

const writeDirectoryEntry = (
  image: Uint8Array,
  startTrack: number,
  startSector: number,
  name: string,
  fileType = 0x82,
) => {
  const dirOffset = tsOffset(18, 1);
  image[dirOffset] = 0;
  image[dirOffset + 1] = 0;
  const entryOffset = dirOffset + 2;
  image[entryOffset] = fileType;
  image[entryOffset + 1] = startTrack;
  image[entryOffset + 2] = startSector;
  const nameBytes = new TextEncoder().encode(name);
  for (let i = 0; i < 16; i += 1) {
    image[entryOffset + 3 + i] = nameBytes[i] ?? 0xa0;
  }
};

const writePrgSector = (image: Uint8Array, track: number, sector: number, prg: Uint8Array) => {
  const offset = tsOffset(track, sector);
  image[offset] = 0;
  image[offset + 1] = Math.max(1, Math.min(254, prg.length));
  image.set(prg, offset + 2);
};

const writePrgSectorWithNext = (
  image: Uint8Array,
  track: number,
  sector: number,
  prg: Uint8Array,
  nextTrack: number,
  nextSector: number,
) => {
  const offset = tsOffset(track, sector);
  image[offset] = nextTrack;
  image[offset + 1] = nextSector;
  image.set(prg, offset + 2);
};

const writeDirectoryEntryGeneric = (
  image: Uint8Array,
  sectorsPerTrack: (track: number) => number,
  dirTrack: number,
  dirSector: number,
  startTrack: number,
  startSector: number,
  name: string,
) => {
  const dirOffset = tsOffsetGeneric(sectorsPerTrack, dirTrack, dirSector);
  image[dirOffset] = 0;
  image[dirOffset + 1] = 0;
  const entryOffset = dirOffset + 2;
  image[entryOffset] = 0x82;
  image[entryOffset + 1] = startTrack;
  image[entryOffset + 2] = startSector;
  const nameBytes = new TextEncoder().encode(name);
  for (let i = 0; i < 16; i += 1) {
    image[entryOffset + 3 + i] = nameBytes[i] ?? 0xa0;
  }
};

const writePrgSectorGeneric = (
  image: Uint8Array,
  sectorsPerTrack: (track: number) => number,
  track: number,
  sector: number,
  prg: Uint8Array,
) => {
  const offset = tsOffsetGeneric(sectorsPerTrack, track, sector);
  image[offset] = 0;
  image[offset + 1] = Math.max(1, Math.min(254, prg.length));
  image.set(prg, offset + 2);
};

const createDiskImageForLayout = (
  sectorsPerTrack: (track: number) => number,
  tracks: number,
  dirTrack: number,
  dirSector: number,
  prg: Uint8Array,
  name = "TEST",
) => {
  let totalSectors = 0;
  for (let t = 1; t <= tracks; t += 1) {
    totalSectors += sectorsPerTrack(t);
  }
  const image = new Uint8Array(totalSectors * 256);
  const startTrack = 1;
  const startSector = 0;
  writeDirectoryEntryGeneric(image, sectorsPerTrack, dirTrack, dirSector, startTrack, startSector, name);
  writePrgSectorGeneric(image, sectorsPerTrack, startTrack, startSector, prg);
  return image;
};

const createDiskImage = (prg: Uint8Array, name = "TEST") => {
  const size = totalSectors1541(35) * 256;
  const image = new Uint8Array(size);
  const startTrack = 1;
  const startSector = 0;
  writeDirectoryEntry(image, startTrack, startSector, name);
  writePrgSector(image, startTrack, startSector, prg);
  return image;
};

const makeBasicPrg = () => {
  const payload = new Uint8Array([0x00, 0x00, 0x0a, 0x00, 0x00, 0x01, 0x02]);
  const prg = new Uint8Array(payload.length + 2);
  prg[0] = 0x01;
  prg[1] = 0x08;
  prg.set(payload, 2);
  return prg;
};

const makeSysPrg = () => {
  const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const prg = new Uint8Array(payload.length + 2);
  prg[0] = 0x00;
  prg[1] = 0x10;
  prg.set(payload, 2);
  return prg;
};

const bytesToString = (bytes: Uint8Array) => String.fromCharCode(...Array.from(bytes));

describe("diskFirstPrg DMA loader", () => {
  beforeEach(() => {
    vi.mocked(injectAutostart).mockReset();
  });

  it("DMA-loads BASIC programs and issues RUN", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeBasicPrg();
    const image = createDiskImage(prg, "BASIC");

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");

    expect(result.isBasic).toBe(true);
    expect(result.loadAddress).toBe(0x0801);
    expect(api.writeMemoryBlock).toHaveBeenCalled();

    const calls = vi.mocked(api.writeMemoryBlock).mock.calls;
    const loadCall = calls[0];
    expect(loadCall[0]).toBe("0801");
    expect(loadCall[1]).toEqual(prg.slice(2));

    const basicPointerCall = calls.find((call) => call[0] === "002B");
    expect(basicPointerCall).toBeTruthy();

    expect(vi.mocked(injectAutostart)).toHaveBeenCalledTimes(1);
    const command = vi.mocked(injectAutostart).mock.calls[0][1] as Uint8Array;
    expect(bytesToString(command)).toContain("RUN");
  });

  it("DMA-loads non-BASIC programs and issues SYS", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImage(prg, "SYS");

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");

    expect(result.isBasic).toBe(false);
    expect(result.loadAddress).toBe(0x1000);
    expect(vi.mocked(injectAutostart)).toHaveBeenCalledTimes(1);
    const command = vi.mocked(injectAutostart).mock.calls[0][1] as Uint8Array;
    expect(bytesToString(command)).toContain("SYS 4096");
  });

  it("rejects unsupported disk image sizes", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const image = new Uint8Array(1234);
    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("Unsupported D64 size");
  });

  it("accepts D64 images with error tables", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const baseImage = createDiskImage(prg, "SYS");
    const errorTableBytes = totalSectors1541(35);
    const image = new Uint8Array(baseImage.length + errorTableBytes);
    image.set(baseImage, 0);

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");

    expect(result.loadAddress).toBe(0x1000);
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
  });

  it("rejects directory listings without PRG entries", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImage(prg, "SYS");
    writeDirectoryEntry(image, 1, 0, "NO-PRG", 0x00);

    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("No PRG found in directory");
  });

  it("rejects disk images with looping PRG sector chains", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImage(prg, "SYS");
    writePrgSectorWithNext(image, 1, 0, prg, 1, 0);

    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow(
      "Loop detected while reading PRG sectors",
    );
  });

  it("loads D71 images and issues SYS when program is non-basic", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImageForLayout(sectorsPerTrack1571, 70, 18, 1, prg, "SYS");

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d71");

    expect(result.isBasic).toBe(false);
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
  });

  it("loads D81 images and issues RUN when program is basic", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeBasicPrg();
    const image = createDiskImageForLayout(sectorsPerTrack1581, 80, 40, 3, prg, "BASIC");

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d81");

    expect(result.isBasic).toBe(true);
    const command = vi.mocked(injectAutostart).mock.calls.at(-1)?.[1] as Uint8Array;
    expect(bytesToString(command)).toContain("RUN");
  });

  it("rejects PRG payloads that are too small", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const tinyPrg = new Uint8Array([0x00]);
    const image = createDiskImage(tinyPrg, "TINY");

    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("Extracted PRG is too small");
  });

  it("rejects PRG payloads that exceed C64 address space", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const prg = new Uint8Array(payload.length + 2);
    prg[0] = 0xfe;
    prg[1] = 0xff;
    prg.set(payload, 2);
    const image = createDiskImage(prg, "BIG");

    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow(
      "PRG payload exceeds C64 address space",
    );
  });

  it("loads 40-track D64 images", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const tracks = 40;
    const totalSecs = totalSectors1541(tracks);
    const image = new Uint8Array(totalSecs * 256);
    writeDirectoryEntry(image, 1, 0, "EXT", 0x82);
    writePrgSector(image, 1, 0, prg);

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.loadAddress).toBe(0x1000);
  });

  it("loads D64 with error table (40-track)", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const tracks = 40;
    const totalSecs = totalSectors1541(tracks);
    const baseSize = totalSecs * 256;
    const image = new Uint8Array(baseSize + totalSecs);
    writeDirectoryEntry(image, 1, 0, "ERR40", 0x82);
    writePrgSector(image, 1, 0, prg);

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.loadAddress).toBe(0x1000);
  });

  it("loads D71 image with error table", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    let totalSecs = 0;
    for (let t = 1; t <= 70; t++) totalSecs += sectorsPerTrack1571(t);
    const baseSize = totalSecs * 256;
    const image = new Uint8Array(baseSize + totalSecs);
    writeDirectoryEntryGeneric(image, sectorsPerTrack1571, 18, 1, 1, 0, "D71ERR");
    writePrgSectorGeneric(image, sectorsPerTrack1571, 1, 0, prg);

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d71");
    expect(result.loadAddress).toBe(0x1000);
  });

  it("rejects unsupported D71 sizes", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const image = new Uint8Array(1234);
    await expect(loadFirstDiskPrgViaDma(api as any, image, "d71")).rejects.toThrow("Unsupported D71 size");
  });

  it("loads D81 image with error table", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const totalSecs = 80 * 40;
    const baseSize = totalSecs * 256;
    const image = new Uint8Array(baseSize + totalSecs);
    writeDirectoryEntryGeneric(image, sectorsPerTrack1581, 40, 3, 1, 0, "D81ERR");
    writePrgSectorGeneric(image, sectorsPerTrack1581, 1, 0, prg);

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d81");
    expect(result.loadAddress).toBe(0x1000);
  });

  it("rejects unsupported D81 sizes", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const image = new Uint8Array(5678);
    await expect(loadFirstDiskPrgViaDma(api as any, image, "d81")).rejects.toThrow("Unsupported D81 size");
  });

  it("throws on unsupported disk image type", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const image = new Uint8Array(1000);
    await expect(loadFirstDiskPrgViaDma(api as any, image, "xyz" as any)).rejects.toThrow("Unsupported disk type");
  });

  it("throws when DMA load fails after retries", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockRejectedValue(new Error("write fail")),
    };
    const prg = makeBasicPrg();
    const image = createDiskImage(prg, "RETRY");

    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("DMA load failed after retries");
  });

  it("reads multi-sector PRG chains", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    // Build a 2-sector PRG: sector 1,0 -> sector 1,1 -> end
    const image = createDiskImage(new Uint8Array([0x01, 0x08, 0xaa]), "MULTI");
    // Overwrite the PRG sector at (1,0) to chain to (1,1)
    const offset0 = tsOffset(1, 0);
    const payload0 = new Uint8Array(254).fill(0xbb);
    payload0[0] = 0x01; // load address low
    payload0[1] = 0x08; // load address high
    image[offset0] = 1; // next track
    image[offset0 + 1] = 1; // next sector
    image.set(payload0, offset0 + 2);

    // Write final sector at (1,1)
    const offset1 = tsOffset(1, 1);
    image[offset1] = 0; // no next track
    image[offset1 + 1] = 4; // 4 bytes used
    image[offset1 + 2] = 0xcc;
    image[offset1 + 3] = 0xdd;
    image[offset1 + 4] = 0xee;
    image[offset1 + 5] = 0xff;

    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.loadAddress).toBe(0x0801);
  });

  it("throws when directory entry has out-of-range track", async () => {
    const api: ApiMock = { writeMemoryBlock: vi.fn() };
    const size = totalSectors1541(35) * 256;
    const image = new Uint8Array(size);
    const dirOffset = tsOffset(18, 1);
    image[dirOffset] = 0;
    image[dirOffset + 1] = 0;
    const entryOffset = dirOffset + 2;
    image[entryOffset] = 0x82; // PRG type
    image[entryOffset + 1] = 36; // track 36 > max 35 for D64
    image[entryOffset + 2] = 0; // sector 0
    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("Track out of range");
  });

  it("throws when directory entry has out-of-range sector", async () => {
    const api: ApiMock = { writeMemoryBlock: vi.fn() };
    const size = totalSectors1541(35) * 256;
    const image = new Uint8Array(size);
    const dirOffset = tsOffset(18, 1);
    image[dirOffset] = 0;
    image[dirOffset + 1] = 0;
    const entryOffset = dirOffset + 2;
    image[entryOffset] = 0x82; // PRG type
    image[entryOffset + 1] = 1; // track 1 (valid)
    image[entryOffset + 2] = 100; // sector 100 > max 21 for track 1
    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("Sector out of range");
  });

  it("throws when extracted PRG chain yields only 1 byte", async () => {
    const api: ApiMock = { writeMemoryBlock: vi.fn() };
    const image = createDiskImage(new Uint8Array([0xaa]), "TINY");
    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("Extracted PRG is too small");
  });

  it("clamps nextSector=0 to 254 bytes when reading final PRG sector", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const size = totalSectors1541(35) * 256;
    const image = new Uint8Array(size);
    writeDirectoryEntry(image, 1, 0, "CLAMP");
    const offset = tsOffset(1, 0);
    image[offset] = 0; // nextTrack=0 (final sector)
    image[offset + 1] = 0; // nextSector=0 → used=0 → clamped to 254
    image[offset + 2] = 0x00; // load addr low
    image[offset + 3] = 0x10; // load addr high → 0x1000
    image.fill(0xde, offset + 4, offset + 256);
    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.loadAddress).toBe(0x1000);
  });

  it("treats short BASIC-addressed PRG (< 8 bytes) as non-BASIC", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = new Uint8Array([0x01, 0x08, 0xaa, 0xbb, 0xcc, 0xdd, 0xee]); // 7 bytes, load=0x0801
    const image = createDiskImage(prg, "SHORT");
    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.isBasic).toBe(false);
    expect(result.loadAddress).toBe(0x0801);
  });

  it("treats BASIC with lineNo=0 as non-BASIC", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    // load=0x0801, nextPtr=0, lineNo=0 → looksLikeTokenisedBasic returns false
    const prg = new Uint8Array([0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const image = createDiskImage(prg, "BADLN");
    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.isBasic).toBe(false);
  });

  it("treats BASIC where token bytes run to end of data (no null) as non-BASIC", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    // load=0x0801, nextPtr=0, lineNo=10, two token bytes with no null terminator
    const prg = new Uint8Array([0x01, 0x08, 0x00, 0x00, 0x0a, 0x00, 0xfe, 0xff]);
    const image = createDiskImage(prg, "NOTERM");
    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.isBasic).toBe(false);
  });

  it("treats BASIC with nextPtr pointing before load address as non-BASIC", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    // nextPtr=0x0700 < 0x0801 → expectedOffset < 0 → false
    const prg = new Uint8Array([0x01, 0x08, 0x00, 0x07, 0x0a, 0x00, 0x00, 0x00]);
    const image = createDiskImage(prg, "LOWPTR");
    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.isBasic).toBe(false);
  });

  it("treats BASIC with nextPtr miscalibrated by more than 2 bytes as non-BASIC", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    // data length=10, nextPtr=0x0809 → expectedOffset=8; after line1 i=6; Math.abs(6-8)=2 still ok
    // but token+null makes j=6, i=7; Math.abs(7-8)=1 ok; need bigger gap:
    // nextPtr=0x0809, no tokens, j=4→null at 4→i=5; Math.abs(5-8)=3 > 2 → false
    const prg = new Uint8Array([
      0x01,
      0x08, // load addr 0x0801
      0x09,
      0x08, // nextPtr = 0x0809 (offset 8 in data)
      0x0a,
      0x00, // lineNo = 10
      0x00, // null at j=4 → i=5; expectedOffset=8; Math.abs(5-8)=3 > 2 → false
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // padding so data.length=10 ≥ expectedOffset=8
    ]);
    const image = createDiskImage(prg, "MISC");
    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.isBasic).toBe(false);
  });

  it("treats BASIC where second line header is truncated as non-BASIC", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    // Line 1: nextPtr=0x0809, lineNo=10, token=0xfe, null → j=5, i=6
    // expectedOffset=8, Math.abs(6-8)=2 ≤ 2 OK.  data.length=9 → i+4=10 > 9 → return false
    const prg = new Uint8Array([
      0x01,
      0x08, // load addr 0x0801
      0x09,
      0x08, // nextPtr = 0x0809
      0x0a,
      0x00, // lineNo = 10
      0xfe, // token byte → j=4→5
      0x00, // null → j=5, i=6; expectedOffset=8, Math.abs(6-8)=2 ok
      0x00,
      0x00,
      0x00, // three more bytes → data.length=9; i+4=10 > 9 → return false
    ]);
    const image = createDiskImage(prg, "TRUNC");
    const result = await loadFirstDiskPrgViaDma(api as any, image, "d64");
    expect(result.isBasic).toBe(false);
  });

  it("throws DMA load failure with unknown error when rejection is not an Error", async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockRejectedValue("plain string failure"),
    };
    const prg = makeBasicPrg();
    const image = createDiskImage(prg, "NOERR");
    await expect(loadFirstDiskPrgViaDma(api as any, image, "d64")).rejects.toThrow("Unknown error");
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadFirstDiskPrgViaDma } from '@/lib/playback/diskFirstPrg';
import { injectAutostart } from '@/lib/playback/autostart';

type ApiMock = {
  writeMemoryBlock: ReturnType<typeof vi.fn>;
};

vi.mock('@/lib/playback/autostart', () => ({
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

const writeDirectoryEntry = (image: Uint8Array, startTrack: number, startSector: number, name: string, fileType = 0x82) => {
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
  name = 'TEST',
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

const createDiskImage = (prg: Uint8Array, name = 'TEST') => {
  const size = totalSectors1541(35) * 256;
  const image = new Uint8Array(size);
  const startTrack = 1;
  const startSector = 0;
  writeDirectoryEntry(image, startTrack, startSector, name);
  writePrgSector(image, startTrack, startSector, prg);
  return image;
};

const makeBasicPrg = () => {
  const payload = new Uint8Array([
    0x00,
    0x00,
    0x0a,
    0x00,
    0x00,
    0x01,
    0x02,
  ]);
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

describe('diskFirstPrg DMA loader', () => {
  beforeEach(() => {
    vi.mocked(injectAutostart).mockReset();
  });

  it('DMA-loads BASIC programs and issues RUN', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeBasicPrg();
    const image = createDiskImage(prg, 'BASIC');

    const result = await loadFirstDiskPrgViaDma(api as any, image, 'd64');

    expect(result.isBasic).toBe(true);
    expect(result.loadAddress).toBe(0x0801);
    expect(api.writeMemoryBlock).toHaveBeenCalled();

    const calls = vi.mocked(api.writeMemoryBlock).mock.calls;
    const loadCall = calls[0];
    expect(loadCall[0]).toBe('0801');
    expect(loadCall[1]).toEqual(prg.slice(2));

    const basicPointerCall = calls.find((call) => call[0] === '002B');
    expect(basicPointerCall).toBeTruthy();

    expect(vi.mocked(injectAutostart)).toHaveBeenCalledTimes(1);
    const command = vi.mocked(injectAutostart).mock.calls[0][1] as Uint8Array;
    expect(bytesToString(command)).toContain('RUN');
  });

  it('DMA-loads non-BASIC programs and issues SYS', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImage(prg, 'SYS');

    const result = await loadFirstDiskPrgViaDma(api as any, image, 'd64');

    expect(result.isBasic).toBe(false);
    expect(result.loadAddress).toBe(0x1000);
    expect(vi.mocked(injectAutostart)).toHaveBeenCalledTimes(1);
    const command = vi.mocked(injectAutostart).mock.calls[0][1] as Uint8Array;
    expect(bytesToString(command)).toContain('SYS 4096');
  });

  it('rejects unsupported disk image sizes', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const image = new Uint8Array(1234);
    await expect(loadFirstDiskPrgViaDma(api as any, image, 'd64')).rejects.toThrow('Unsupported D64 size');
  });

  it('accepts D64 images with error tables', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const baseImage = createDiskImage(prg, 'SYS');
    const errorTableBytes = totalSectors1541(35);
    const image = new Uint8Array(baseImage.length + errorTableBytes);
    image.set(baseImage, 0);

    const result = await loadFirstDiskPrgViaDma(api as any, image, 'd64');

    expect(result.loadAddress).toBe(0x1000);
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
  });

  it('rejects directory listings without PRG entries', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImage(prg, 'SYS');
    writeDirectoryEntry(image, 1, 0, 'NO-PRG', 0x00);

    await expect(loadFirstDiskPrgViaDma(api as any, image, 'd64')).rejects.toThrow('No PRG found in directory');
  });

  it('rejects disk images with looping PRG sector chains', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImage(prg, 'SYS');
    writePrgSectorWithNext(image, 1, 0, prg, 1, 0);

    await expect(loadFirstDiskPrgViaDma(api as any, image, 'd64')).rejects.toThrow('Loop detected while reading PRG sectors');
  });

  it('loads D71 images and issues SYS when program is non-basic', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeSysPrg();
    const image = createDiskImageForLayout(sectorsPerTrack1571, 70, 18, 1, prg, 'SYS');

    const result = await loadFirstDiskPrgViaDma(api as any, image, 'd71');

    expect(result.isBasic).toBe(false);
    expect(vi.mocked(injectAutostart)).toHaveBeenCalled();
  });

  it('loads D81 images and issues RUN when program is basic', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const prg = makeBasicPrg();
    const image = createDiskImageForLayout(sectorsPerTrack1581, 80, 40, 3, prg, 'BASIC');

    const result = await loadFirstDiskPrgViaDma(api as any, image, 'd81');

    expect(result.isBasic).toBe(true);
    const command = vi.mocked(injectAutostart).mock.calls.at(-1)?.[1] as Uint8Array;
    expect(bytesToString(command)).toContain('RUN');
  });

  it('rejects PRG payloads that are too small', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const tinyPrg = new Uint8Array([0x00]);
    const image = createDiskImage(tinyPrg, 'TINY');

    await expect(loadFirstDiskPrgViaDma(api as any, image, 'd64')).rejects.toThrow('Extracted PRG is too small');
  });

  it('rejects PRG payloads that exceed C64 address space', async () => {
    const api: ApiMock = {
      writeMemoryBlock: vi.fn().mockResolvedValue({ errors: [] }),
    };
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const prg = new Uint8Array(payload.length + 2);
    prg[0] = 0xfe;
    prg[1] = 0xff;
    prg.set(payload, 2);
    const image = createDiskImage(prg, 'BIG');

    await expect(loadFirstDiskPrgViaDma(api as any, image, 'd64')).rejects.toThrow('PRG payload exceeds C64 address space');
  });
});

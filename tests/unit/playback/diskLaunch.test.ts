/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildLoadCommand,
  extractDiskEntry,
  mountAndLoadEntry,
  resolveBusId,
  runDiskEntry,
  stripNamePadding,
} from "@/lib/playback/diskLaunch";
import type { DiskDirectoryEntry } from "@/lib/disks/diskImage";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";
import { featureFlagManager } from "@/lib/config/featureFlags";

vi.mock("@/lib/remoteInput/kernalFallbackInjector", () => ({
  enqueueKeyboardBufferInjection: vi.fn(async () => ({ dropped: false })),
}));

const SECTOR = 256;
const sectorsPerTrack1541 = (t: number) => (t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17);
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

const makeD64WithEntry = (prg: Uint8Array, name = "GAME") => {
  const image = new Uint8Array(totalSectors1541(35) * SECTOR);
  const dir = tsOffset(18, 1);
  image[dir + 2] = 0x82; // closed PRG
  image[dir + 3] = 1; // start track
  image[dir + 4] = 0; // start sector
  const nameBytes = new TextEncoder().encode(name);
  for (let i = 0; i < 16; i += 1) image[dir + 5 + i] = nameBytes[i] ?? 0xa0;
  const data = tsOffset(1, 0);
  image[data] = 0;
  image[data + 1] = Math.max(1, Math.min(254, prg.length));
  image.set(prg, data + 2);
  return image;
};

const entryFor = (overrides: Partial<DiskDirectoryEntry> = {}): DiskDirectoryEntry => ({
  index: 0,
  name: "GAME",
  rawName: Uint8Array.from([...new TextEncoder().encode("GAME"), 0xa0, 0xa0, 0xa0]),
  type: "PRG",
  closed: true,
  locked: false,
  startTrack: 1,
  startSector: 0,
  blocks: 3,
  loadAddress: 0x0801,
  ...overrides,
});

const setFlag = (value: boolean) => {
  vi.spyOn(featureFlagManager, "getSnapshot").mockReturnValue({ flags: { launch_safety_enabled: value } } as never);
};

const bytesToString = (bytes: Uint8Array) => String.fromCharCode(...Array.from(bytes));

describe("diskLaunch — helpers", () => {
  it("stripNamePadding removes trailing 0xA0/0x00 but keeps interior bytes", () => {
    const raw = Uint8Array.from([65, 0x00, 66, 0xa0, 0xa0]);
    expect(Array.from(stripNamePadding(raw))).toEqual([65, 0x00, 66]);
  });

  it('buildLoadCommand emits LOAD"<name>",<bus>,1 + CR with the raw name', () => {
    const raw = Uint8Array.from([...new TextEncoder().encode("GAME"), 0xa0, 0xa0]);
    const cmd = buildLoadCommand(raw, 9);
    expect(bytesToString(cmd)).toBe('LOAD"GAME",9,1\r');
  });

  it("extractDiskEntry returns the program bytes", () => {
    const prg = new Uint8Array([0x01, 0x08, 0xaa, 0xbb, 0xcc]);
    const image = makeD64WithEntry(prg);
    const bytes = extractDiskEntry(image, "d64", entryFor());
    expect(Array.from(bytes)).toEqual([0x01, 0x08, 0xaa, 0xbb, 0xcc]);
  });

  it("extractDiskEntry rejects a too-small payload", () => {
    const image = makeD64WithEntry(new Uint8Array([0x01, 0x08]));
    // final sector used=2 -> only 2 bytes, < 3
    const entry = entryFor();
    expect(() => extractDiskEntry(image, "d64", entry)).toThrow("Extracted PRG is too small");
  });
});

describe("diskLaunch — resolveBusId", () => {
  it("returns the drive's bus id from /v1/drives", async () => {
    const api = { getDrives: vi.fn(async () => ({ drives: [{ a: { bus_id: 9 } }, { b: { bus_id: 10 } }] })) };
    await expect(resolveBusId(api as never, "b")).resolves.toBe(10);
  });

  it("defaults to 8 when unavailable or on error", async () => {
    await expect(resolveBusId({} as never, "a")).resolves.toBe(8);
    const api = {
      getDrives: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    await expect(resolveBusId(api as never, "a")).resolves.toBe(8);
    const noBus = { getDrives: vi.fn(async () => ({ drives: [{ a: {} }] })) };
    await expect(resolveBusId(noBus as never, "a")).resolves.toBe(8);
  });
});

describe("diskLaunch — runDiskEntry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(enqueueKeyboardBufferInjection).mockResolvedValue({ dropped: false });
    setFlag(false); // isolate from Launch Safety unless a test opts in
  });

  it("Run uploads via run_prg", async () => {
    const image = makeD64WithEntry(new Uint8Array([0x01, 0x08, 0xaa, 0xbb]));
    const api = {
      runPrgUpload: vi.fn(async () => ({ errors: [] })),
      loadPrgUpload: vi.fn(async () => ({ errors: [] })),
    };
    await runDiskEntry(api as never, image, "d64", entryFor(), "run");
    expect(api.runPrgUpload).toHaveBeenCalledTimes(1);
    expect(api.loadPrgUpload).not.toHaveBeenCalled();
    const [blob, meta] = api.runPrgUpload.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(meta.filename).toBe("GAME.prg");
  });

  it("Load uploads via load_prg", async () => {
    const image = makeD64WithEntry(new Uint8Array([0x01, 0x08, 0xaa, 0xbb]));
    const api = {
      runPrgUpload: vi.fn(async () => ({ errors: [] })),
      loadPrgUpload: vi.fn(async () => ({ errors: [] })),
    };
    await runDiskEntry(api as never, image, "d64", entryFor(), "load");
    expect(api.loadPrgUpload).toHaveBeenCalledTimes(1);
    expect(api.runPrgUpload).not.toHaveBeenCalled();
  });

  it("rejects a non-PRG entry", async () => {
    const image = makeD64WithEntry(new Uint8Array([0x01, 0x08, 0xaa]));
    const api = { runPrgUpload: vi.fn() };
    await expect(runDiskEntry(api as never, image, "d64", entryFor({ type: "SEQ" }), "run")).rejects.toThrow(
      "Only PRG files can be launched directly",
    );
    expect(api.runPrgUpload).not.toHaveBeenCalled();
  });

  it("rejects a splat (not closed) entry", async () => {
    const image = makeD64WithEntry(new Uint8Array([0x01, 0x08, 0xaa]));
    const api = { runPrgUpload: vi.fn() };
    await expect(runDiskEntry(api as never, image, "d64", entryFor({ closed: false }), "run")).rejects.toThrow(
      "not properly closed",
    );
  });

  it("parks the cartridge around the run when Launch Safety is on", async () => {
    setFlag(true);
    const image = makeD64WithEntry(new Uint8Array([0x01, 0x08, 0xaa, 0xbb]));
    const order: string[] = [];
    const api = {
      getCachedConfigItem: vi.fn(() => ({ selected: "Retro Replay" })),
      setConfigValue: vi.fn(async (_c: string, _i: string, v: string) => {
        order.push(`set:${v === "" ? "<empty>" : v}`);
        return { errors: [] };
      }),
      runPrgUpload: vi.fn(async () => {
        order.push("run");
        return { errors: [] };
      }),
    };
    await runDiskEntry(api as never, image, "d64", entryFor(), "run");
    expect(order).toEqual(["set:<empty>", "run", "set:Retro Replay"]);
  });
});

describe("diskLaunch — mountAndLoadEntry", () => {
  beforeEach(() => {
    vi.mocked(enqueueKeyboardBufferInjection).mockReset();
    vi.mocked(enqueueKeyboardBufferInjection).mockResolvedValue({ dropped: false });
  });

  it("mounts, resets, settles, then injects LOAD and RUN in order", async () => {
    const order: string[] = [];
    const api = {
      machineReset: vi.fn(async () => {
        order.push("reset");
        return { errors: [] };
      }),
      getDrives: vi.fn(async () => ({ drives: [{ a: { bus_id: 8 } }] })),
    };
    vi.mocked(enqueueKeyboardBufferInjection).mockImplementation(async (_api, payload) => {
      order.push(`inject:${bytesToString(payload as Uint8Array)}`);
      return { dropped: false };
    });
    await mountAndLoadEntry(api as never, "a", entryFor(), {
      mount: async () => {
        order.push("mount");
      },
      bootMenuAnswerEnabled: false,
      bootSettleMs: 2800,
      delayFn: async () => {},
    });
    expect(order).toEqual(["mount", "reset", 'inject:LOAD"GAME",8,1\r', "inject:RUN\r"]);
  });
});

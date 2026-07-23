/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDiskExplorer, diskTypeForPath } from "@/hooks/useDiskExplorer";
import type { DiskEntry } from "@/lib/disks/diskTypes";

vi.mock("@/lib/remoteInput/kernalFallbackInjector", () => ({
  enqueueKeyboardBufferInjection: vi.fn(async () => ({ dropped: false })),
}));

const SECTOR = 256;
const spt = (t: number) => (t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17);
const total = (tracks: number) => {
  let s = 0;
  for (let t = 1; t <= tracks; t += 1) s += spt(t);
  return s;
};
const ts = (track: number, sector: number) => {
  let o = 0;
  for (let t = 1; t < track; t += 1) o += spt(t);
  return (o + sector) * SECTOR;
};

const makeD64 = (name = "GAME") => {
  const image = new Uint8Array(total(35) * SECTOR);
  const dir = ts(18, 1);
  image[dir + 2] = 0x82; // closed PRG
  image[dir + 3] = 1;
  image[dir + 4] = 0;
  const nb = new TextEncoder().encode(name);
  for (let i = 0; i < 16; i += 1) image[dir + 5 + i] = nb[i] ?? 0xa0;
  const data = ts(1, 0);
  image[data] = 0;
  image[data + 1] = 4;
  image.set([0x01, 0x08, 0xaa, 0xbb], data + 2);
  return image;
};

const diskEntry = (overrides: Partial<DiskEntry> = {}): DiskEntry => ({
  id: "local:/GAMES/COMPILATION.D64",
  path: "/GAMES/COMPILATION.D64",
  location: "local",
  ...overrides,
});

describe("diskTypeForPath", () => {
  it("recognises explorable disk types only", () => {
    expect(diskTypeForPath("/a/b.d64")).toBe("d64");
    expect(diskTypeForPath("/a/b.D71")).toBe("d71");
    expect(diskTypeForPath("/a/b.d81")).toBe("d81");
    expect(diskTypeForPath("/a/b.g64")).toBeNull();
    expect(diskTypeForPath("/a/b.prg")).toBeNull();
  });
});

describe("useDiskExplorer", () => {
  it("opens a disk and lists its directory", async () => {
    const api = { runPrgUpload: vi.fn(async () => ({ errors: [] })) };
    const loadImage = vi.fn(async () => makeD64("COMPILATION"));
    const { result } = renderHook(() => useDiskExplorer({ api: api as never, loadImage }));

    await act(async () => {
      await result.current.openDisk(diskEntry());
    });
    await waitFor(() => expect(result.current.entries).not.toBeNull());
    expect(result.current.open).toBe(true);
    expect(result.current.diskName).toBe("COMPILATION.D64");
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries?.[0].name).toBe("COMPILATION");
  });

  it("rejects a non-disk image with a toast and does not open", async () => {
    const onToast = vi.fn();
    const { result } = renderHook(() => useDiskExplorer({ api: {} as never, loadImage: vi.fn(), onToast }));
    await act(async () => {
      await result.current.openDisk(diskEntry({ path: "/x.g64" }));
    });
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    expect(result.current.open).toBe(false);
  });

  it("surfaces an unreadable image as an error", async () => {
    const loadImage = vi.fn(async () => {
      throw new Error("FTP timeout");
    });
    const { result } = renderHook(() => useDiskExplorer({ api: {} as never, loadImage }));
    await act(async () => {
      await result.current.openDisk(diskEntry());
    });
    await waitFor(() => expect(result.current.error).toContain("Unreadable directory"));
    expect(result.current.error).toContain("FTP timeout");
  });

  it("runs an entry via runPrgUpload and closes on success", async () => {
    const api = { runPrgUpload: vi.fn(async () => ({ errors: [] })) };
    const onToast = vi.fn();
    const { result } = renderHook(() =>
      useDiskExplorer({ api: api as never, loadImage: vi.fn(async () => makeD64()), onToast }),
    );
    await act(async () => {
      await result.current.openDisk(diskEntry());
    });
    await waitFor(() => expect(result.current.entries).not.toBeNull());
    const entry = result.current.entries![0];
    await act(async () => {
      await result.current.runAction("run", entry);
    });
    expect(api.runPrgUpload).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("Launched") }));
  });

  it("errors Mount & Load when no mount function is provided", async () => {
    const onToast = vi.fn();
    const { result } = renderHook(() =>
      useDiskExplorer({ api: {} as never, loadImage: vi.fn(async () => makeD64()), onToast }),
    );
    await act(async () => {
      await result.current.openDisk(diskEntry());
    });
    await waitFor(() => expect(result.current.entries).not.toBeNull());
    await act(async () => {
      await result.current.runAction("mountAndLoad", result.current.entries![0]);
    });
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Launch failed" }));
  });
});

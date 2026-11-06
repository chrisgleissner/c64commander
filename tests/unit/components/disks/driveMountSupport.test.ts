/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildMountTargetLabel,
  driveChangedUnderCard,
  mountOntoPoweredDrive,
} from "@/components/disks/driveMountSupport";

describe("mount target label", () => {
  it("marks a drive that is off", () => {
    expect(buildMountTargetLabel({ key: "b", busId: 9, driveType: "1541", mounted: false, powerEnabled: false })).toBe(
      "Drive B (#9, 1541) • off",
    );
  });

  it("marks a mounted drive, and does not mark a drive whose power state is unknown", () => {
    expect(
      buildMountTargetLabel({ key: "a", busId: 8, driveType: "1581", mounted: true, powerEnabled: undefined }),
    ).toBe("Drive A (#8, 1581) • mounted");
    expect(buildMountTargetLabel({ key: "a", busId: 8, driveType: "1541", mounted: true, powerEnabled: false })).toBe(
      "Drive A (#8, 1541) • mounted, off",
    );
  });
});

describe("mountOntoPoweredDrive", () => {
  it("turns an off drive on before mounting onto it", async () => {
    const calls: string[] = [];
    const api = { driveOn: vi.fn(async () => (calls.push("driveOn"), { errors: [] })) };
    const result = await mountOntoPoweredDrive(api, "b", false, async () => (calls.push("mount"), "mounted"));
    expect(api.driveOn).toHaveBeenCalledWith("b");
    expect(calls).toEqual(["driveOn", "mount"]);
    expect(result).toEqual({ outcome: "mounted", poweredOn: true });
  });

  it("leaves a drive that is on, or whose state is unknown, alone", async () => {
    const api = { driveOn: vi.fn(async () => ({ errors: [] })) };
    await mountOntoPoweredDrive(api, "a", true, async () => "mounted");
    await mountOntoPoweredDrive(api, "a", undefined, async () => "mounted");
    expect(api.driveOn).not.toHaveBeenCalled();
  });

  it("does not mount when the drive cannot be turned on, and names the drive in the error", async () => {
    const api = { driveOn: vi.fn(async () => Promise.reject(new Error("HTTP 500"))) };
    const mount = vi.fn(async () => "mounted");
    await expect(mountOntoPoweredDrive(api, "b", false, mount)).rejects.toThrow(
      "Could not turn Drive B on to mount the disk: HTTP 500",
    );
    expect(mount).not.toHaveBeenCalled();
  });
});

describe("driveChangedUnderCard", () => {
  const drive = (image_path: string, image_file: string) => ({ enabled: true, image_path, image_file }) as any;

  it("reports a change when a disk the card did not show is now mounted", () => {
    expect(
      driveChangedUnderCard({
        shownDiskId: null,
        shownInfo: drive("/USB2", "mine.d64"),
        freshInfo: drive("/USB2", "theirs.d64"),
        freshDiskId: null,
      }),
    ).toBe(true);
  });

  it("reports a change when the drive now resolves to another library disk than the card shows", () => {
    expect(
      driveChangedUnderCard({
        shownDiskId: "disk-mine",
        shownInfo: drive("/USB2", "c64commander-disk-work-0123abcd-a.d64"),
        freshInfo: drive("/USB2", "c64commander-disk-work-fedc9876-a.d64"),
        freshDiskId: null,
      }),
    ).toBe(true);
  });

  it("reports no change when the drive still holds the card's disk, even if the cached poll predates its mount", () => {
    expect(
      driveChangedUnderCard({
        shownDiskId: "disk-mine",
        shownInfo: undefined,
        freshInfo: drive("/USB2", "c64commander-disk-work-0123abcd-a.d64"),
        freshDiskId: "disk-mine",
      }),
    ).toBe(false);
    expect(
      driveChangedUnderCard({
        shownDiskId: null,
        shownInfo: drive("/USB2", "mine.d64"),
        freshInfo: drive("/USB2", "mine.d64"),
        freshDiskId: null,
      }),
    ).toBe(false);
  });

  it("reports no change when the drive is now empty", () => {
    expect(
      driveChangedUnderCard({
        shownDiskId: "disk-mine",
        shownInfo: drive("/USB2", "mine.d64"),
        freshInfo: drive("", ""),
        freshDiskId: null,
      }),
    ).toBe(false);
  });
});

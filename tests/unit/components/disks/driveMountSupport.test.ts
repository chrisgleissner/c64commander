/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { buildMountTargetLabel, mountOntoPoweredDrive } from "@/components/disks/driveMountSupport";

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

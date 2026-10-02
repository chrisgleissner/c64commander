/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeDriveImage,
  endPlayLaunchMounts,
  forgetPlayLaunchMount,
  peekPlayLaunchMount,
  recordPlayLaunchMount,
  resolvePriorImageForLaunch,
} from "@/lib/playback/playLaunchMounts";
import { beginMachineTransition } from "@/lib/deviceInteraction/deviceActivityGate";
import { buildDiskWorkPath } from "@/lib/disks/diskPath";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const drivesHolding = (images: Partial<Record<"a" | "b", { image_path?: string; image_file?: string }>>) => ({
  drives: Object.entries(images).map(([drive, info]) => ({ [drive]: { enabled: true, ...info } })),
  errors: [],
});

// By default each drive still holds the image Play recorded for it.
const createDriveApi = (host = "c64u") => ({
  getDeviceHost: vi.fn(() => host),
  getDrives: vi.fn(async () =>
    drivesHolding({
      a: { image_file: peekPlayLaunchMount(host, "a")?.launchPath },
      b: { image_file: peekPlayLaunchMount(host, "b")?.launchPath },
    }),
  ),
  unmountDrive: vi.fn(async () => ({ errors: [] })),
  mountDrive: vi.fn(async () => ({ errors: [] })),
});

describe("Stop returns the drives to how Play found them", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("ejects the image Play mounted and leaves a drive Play did not mount alone", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/Games/game.d64", priorImagePath: null });
    const api = createDriveApi();

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).toHaveBeenCalledTimes(1);
    expect(api.unmountDrive).toHaveBeenCalledWith("a");
    expect(api.mountDrive).not.toHaveBeenCalled();
    expect(peekPlayLaunchMount("c64u", "a")).toBeNull();
  });

  it("puts the user's own image back after ejecting the one Play mounted over it", async () => {
    recordPlayLaunchMount("c64u", {
      drive: "a",
      launchPath: "/USB0/Games/game.d64",
      priorImagePath: "/USB0/Mine/work.d71",
    });
    const api = createDriveApi();

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).toHaveBeenCalledWith("a");
    expect(api.mountDrive).toHaveBeenCalledWith("a", "/USB0/Mine/work.d71", "d71");
    expect(api.unmountDrive.mock.invocationCallOrder[0]).toBeLessThan(api.mountDrive.mock.invocationCallOrder[0]);
  });

  it("never ejects a disk mounted by hand after Play's mount", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/Games/game.d64", priorImagePath: null });
    forgetPlayLaunchMount("c64u", "a");
    const api = createDriveApi();

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).not.toHaveBeenCalled();
    expect(api.mountDrive).not.toHaveBeenCalled();
  });

  it("leaves another device's drives to a Stop on that device", async () => {
    recordPlayLaunchMount("other-ultimate", { drive: "a", launchPath: "/USB0/a.d64", priorImagePath: null });
    const api = createDriveApi("c64u");

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).not.toHaveBeenCalled();
    expect(peekPlayLaunchMount("other-ultimate", "a")).not.toBeNull();
  });

  it("still knows what Play mounted after the app was restarted", () => {
    recordPlayLaunchMount("c64u", { drive: "b", launchPath: "/USB0/b.d81", priorImagePath: null });
    const persisted = localStorage.getItem("c64u_play_launch_mounts");

    localStorage.clear();
    localStorage.setItem("c64u_play_launch_mounts", persisted ?? "");

    expect(peekPlayLaunchMount("c64u", "b")).toEqual({ drive: "b", launchPath: "/USB0/b.d81", priorImagePath: null });
  });

  it("keeps the user's image as the one to restore when Play mounts a second launch image over its first", () => {
    const first = { drive: "a" as const, launchPath: "/USB0/one.d64", priorImagePath: "/USB0/Mine/work.d64" };

    expect(resolvePriorImageForLaunch(first, { image_path: "/USB0", image_file: "one.d64" })).toBe(
      "/USB0/Mine/work.d64",
    );
    expect(resolvePriorImageForLaunch(null, { image_path: "", image_file: "/USB0/Mine/work.d64" })).toBe(
      "/USB0/Mine/work.d64",
    );
    expect(resolvePriorImageForLaunch(null, { image_file: "" })).toBeNull();
  });

  it("reads a drive's image the way both firmware families report it", () => {
    expect(describeDriveImage({ image_path: "/USB0/Games/", image_file: "x.d64" })).toBe("/USB0/Games/x.d64");
    expect(describeDriveImage({ image_path: "", image_file: "/USB0/Games/x.d64" })).toBe("/USB0/Games/x.d64");
    expect(describeDriveImage(null)).toBeNull();
  });

  it("logs a failed eject and still tries the other drive", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/a.d64", priorImagePath: null });
    recordPlayLaunchMount("c64u", { drive: "b", launchPath: "/USB0/b.d64", priorImagePath: null });
    const api = createDriveApi();
    api.unmountDrive.mockRejectedValueOnce(new Error("Firmware rejected drive A eject"));
    const { addErrorLog } = await import("@/lib/logging");

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).toHaveBeenCalledWith("b");
    expect(addErrorLog).toHaveBeenCalledWith(
      "Stop could not return the drive to how Play found it",
      expect.objectContaining({ drive: "a" }),
    );
  });

  it("keeps a drive whose eject failed on record, so the next Stop ejects it again", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/a.d64", priorImagePath: null });
    const api = createDriveApi();
    api.unmountDrive.mockRejectedValueOnce(new Error("Network error"));

    await endPlayLaunchMounts(api);

    expect(peekPlayLaunchMount("c64u", "a")).not.toBeNull();
    await endPlayLaunchMounts(api);
    expect(api.unmountDrive).toHaveBeenCalledTimes(2);
    expect(peekPlayLaunchMount("c64u", "a")).toBeNull();
  });

  it("waits for a reset or reboot in progress to settle before ejecting", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/a.d64", priorImagePath: null });
    const api = createDriveApi();
    const endTransition = beginMachineTransition(0);

    const ending = endPlayLaunchMounts(api);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.unmountDrive).not.toHaveBeenCalled();

    endTransition();
    await ending;
    expect(api.unmountDrive).toHaveBeenCalledWith("a");
  });

  it("leaves a disk mounted by other means alone, even when the app never saw that mount", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/Games/game.d64", priorImagePath: "/USB0/old.d64" });
    const api = createDriveApi();
    api.getDrives.mockResolvedValueOnce(drivesHolding({ a: { image_path: "/USB0/Mine/", image_file: "hand.d64" } }));

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).not.toHaveBeenCalled();
    expect(api.mountDrive).not.toHaveBeenCalled();
    expect(peekPlayLaunchMount("c64u", "a")).toBeNull();
  });

  it("ejects a launch image the device reports under its upload name rather than its library path", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/Local/Games/game.d64", priorImagePath: null });
    const api = createDriveApi();
    api.getDrives.mockResolvedValueOnce(drivesHolding({ a: { image_path: "/Temp/", image_file: "game.d64" } }));

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).toHaveBeenCalledWith("a");
  });

  it("ejects nothing and keeps the record when the drives cannot be read", async () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/Games/game.d64", priorImagePath: null });
    const api = createDriveApi();
    api.getDrives.mockRejectedValueOnce(new Error("Network error"));

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).not.toHaveBeenCalled();
    expect(peekPlayLaunchMount("c64u", "a")).not.toBeNull();
  });

  it("does not put back a Home disk's work file, whose write-back record Play's mount already finalized, and says so", async () => {
    recordPlayLaunchMount("c64u", {
      drive: "a",
      launchPath: "/USB0/Games/game.d64",
      priorImagePath: buildDiskWorkPath("Usb0", "a", "d64"),
    });
    const api = createDriveApi();
    const { addLog } = await import("@/lib/logging");
    const { toast } = await import("@/hooks/use-toast");

    await endPlayLaunchMounts(api);

    expect(api.unmountDrive).toHaveBeenCalledWith("a");
    expect(api.mountDrive).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("not put back"),
      expect.objectContaining({ drive: "a", priorImagePath: buildDiskWorkPath("Usb0", "a", "d64") }),
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Disk not put back in drive A" }));
  });
});

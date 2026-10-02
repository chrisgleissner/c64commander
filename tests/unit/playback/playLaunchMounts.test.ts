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

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

const createDriveApi = (host = "c64u") => ({
  getDeviceHost: vi.fn(() => host),
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
});

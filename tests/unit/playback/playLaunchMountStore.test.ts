/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/logging", () => logs);

import {
  forgetPlayLaunchMount,
  hasAnyPlayLaunchMount,
  peekPlayLaunchMount,
  playLaunchMountsFor,
  recordPlayLaunchMount,
} from "@/lib/playback/playLaunchMountStore";
import { describeDriveImage } from "@/lib/playback/playLaunchMounts";

const STORAGE_KEY = "c64u_play_launch_mounts";

beforeEach(() => {
  localStorage.clear();
  logs.addLog.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("the record of disks Play mounted", () => {
  it("treats an unreadable record as empty and logs it", () => {
    localStorage.setItem(STORAGE_KEY, "{broken");

    expect(peekPlayLaunchMount("c64u", "a")).toBeNull();
    expect(hasAnyPlayLaunchMount()).toBe(false);
    expect(logs.addLog).toHaveBeenCalledWith(
      "warn",
      "Could not read the record of disks Play mounted",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("logs a record that cannot be saved instead of failing the launch", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() =>
      recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/game.d64", priorImagePath: null }),
    ).not.toThrow();
    expect(logs.addLog).toHaveBeenCalledWith(
      "warn",
      "Could not save the record of disks Play mounted",
      expect.objectContaining({ error: "quota exceeded" }),
    );
  });

  it("forgets one drive, keeps the other, and drops the device once no drive is left", () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/a.d64", priorImagePath: null });
    recordPlayLaunchMount("c64u", { drive: "b", launchPath: "/USB0/b.d64", priorImagePath: null });

    forgetPlayLaunchMount("c64u", "a");
    expect(playLaunchMountsFor("c64u").map((mount) => mount.drive)).toEqual(["b"]);

    forgetPlayLaunchMount("c64u", "b");
    expect(hasAnyPlayLaunchMount()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("ignores a drive name that is not a launch drive", () => {
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/a.d64", priorImagePath: null });

    forgetPlayLaunchMount("c64u", "softiec");

    expect(peekPlayLaunchMount("c64u", "a")?.launchPath).toBe("/USB0/a.d64");
  });
});

describe("describeDriveImage", () => {
  it("joins the image path and file whether or not the path ends in a slash", () => {
    expect(describeDriveImage({ image_path: "/USB0/Games/", image_file: "game.d64" })).toBe("/USB0/Games/game.d64");
    expect(describeDriveImage({ image_path: "/USB0/Games", image_file: "game.d64" })).toBe("/USB0/Games/game.d64");
  });

  it("puts a file reported without a path at the root, and reads a blank file name as an empty drive", () => {
    expect(describeDriveImage({ image_file: "game.d64" })).toBe("/game.d64");
    expect(describeDriveImage({ image_path: "/USB0", image_file: "   " })).toBeNull();
    expect(describeDriveImage(null)).toBeNull();
  });
});

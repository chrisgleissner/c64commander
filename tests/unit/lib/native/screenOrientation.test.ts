/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyScreenOrientationMode } from "@/lib/native/screenOrientation";

const { lockMock, unlockMock, isNativePlatformMock } = vi.hoisted(() => ({
  lockMock: vi.fn(async () => undefined),
  unlockMock: vi.fn(async () => undefined),
  isNativePlatformMock: vi.fn(() => true),
}));

vi.mock("@capacitor/screen-orientation", () => ({
  ScreenOrientation: {
    lock: lockMock,
    unlock: unlockMock,
  },
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => "android",
  isNativePlatform: isNativePlatformMock,
}));

describe("applyScreenOrientationMode", () => {
  beforeEach(() => {
    lockMock.mockClear();
    unlockMock.mockClear();
    isNativePlatformMock.mockReturnValue(true);
  });

  it("locks native portrait and landscape modes", async () => {
    await applyScreenOrientationMode("portrait");
    await applyScreenOrientationMode("landscape");

    expect(lockMock).toHaveBeenNthCalledWith(1, { orientation: "portrait" });
    expect(lockMock).toHaveBeenNthCalledWith(2, { orientation: "landscape" });
    expect(unlockMock).not.toHaveBeenCalled();
  });

  it("unlocks native orientation in auto mode", async () => {
    await applyScreenOrientationMode("auto");

    expect(unlockMock).toHaveBeenCalledTimes(1);
    expect(lockMock).not.toHaveBeenCalled();
  });

  it("does not call the plugin on web", async () => {
    isNativePlatformMock.mockReturnValue(false);

    await applyScreenOrientationMode("landscape");

    expect(lockMock).not.toHaveBeenCalled();
    expect(unlockMock).not.toHaveBeenCalled();
  });

  it("logs a warning and resolves when locking fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    lockMock.mockRejectedValueOnce(new Error("lock unavailable"));

    await expect(applyScreenOrientationMode("portrait")).resolves.toBeUndefined();

    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to apply screen orientation mode",
      expect.objectContaining({ operation: "SCREEN_ORIENTATION_APPLY", mode: "portrait" }),
    );
    warnSpy.mockRestore();
  });

  it("normalizes non-Error rejection values when unlocking fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    unlockMock.mockRejectedValueOnce("string failure");

    await expect(applyScreenOrientationMode("auto")).resolves.toBeUndefined();

    expect(unlockMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to apply screen orientation mode",
      expect.objectContaining({ mode: "auto" }),
    );
    warnSpy.mockRestore();
  });
});

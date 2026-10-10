/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

import { addErrorLog } from "@/lib/logging";
import {
  isPatchSeekUnsafe,
  markPatchSeekUnsafe,
  patchSeekFirmwareKey,
} from "@/lib/playback/remoteSeek/patchSeekSupport";

describe("firmware whose SID player is unsafe to patch", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(addErrorLog).mockClear();
  });

  it("is recorded once per device and firmware, and a firmware update is tried afresh", () => {
    const old = patchSeekFirmwareKey({ unique_id: "F13E69", firmware_version: "3.15" });
    const updated = patchSeekFirmwareKey({ unique_id: "f13e69", firmware_version: "3.16" });
    expect(isPatchSeekUnsafe(old)).toBe(false);
    expect(markPatchSeekUnsafe(old, "code changed")).toBe(true);
    expect(markPatchSeekUnsafe(old, "code changed")).toBe(false);
    expect(isPatchSeekUnsafe(old)).toBe(true);
    expect(isPatchSeekUnsafe(updated)).toBe(false);
  });

  it("logs a record it cannot read or store, and still tells the user once", () => {
    localStorage.setItem("c64u_remote_seek_patch_unsafe_v1", "{not json");
    expect(isPatchSeekUnsafe("u2|3.15")).toBe(false);
    expect(addErrorLog).toHaveBeenCalledWith(
      "Remote seek could not read which firmware is unsafe to patch",
      expect.anything(),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    onTestFinished(() => setItem.mockRestore());
    expect(markPatchSeekUnsafe("u2|3.15", "code changed")).toBe(true);
    expect(addErrorLog).toHaveBeenCalledWith(
      "Remote seek could not record which firmware is unsafe to patch",
      expect.anything(),
    );
  });
});

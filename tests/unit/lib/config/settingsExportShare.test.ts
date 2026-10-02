/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isNative: true,
  writeFile: vi.fn(),
  getUri: vi.fn(),
  share: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.isNative } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
  Filesystem: { writeFile: native.writeFile, getUri: native.getUri },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: native.share } }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { shareSettingsExport } from "@/lib/config/settingsExportShare";

describe("exporting settings", () => {
  beforeEach(() => {
    native.isNative = true;
    native.writeFile.mockReset().mockResolvedValue(undefined);
    native.getUri.mockReset().mockResolvedValue({ uri: "file:///cache/c64commander-settings.json" });
    native.share.mockReset().mockResolvedValue(undefined);
  });

  it("hands the file to the share sheet on a phone, where a download link saves nothing", async () => {
    await expect(shareSettingsExport('{"a":1}', "c64commander-settings.json")).resolves.toBe(true);

    expect(native.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "c64commander-settings.json", data: '{"a":1}', directory: "CACHE" }),
    );
    expect(native.share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ["file:///cache/c64commander-settings.json"] }),
    );
  });

  it("treats a dismissed share sheet as a choice, not a failure", async () => {
    native.share.mockRejectedValue(new Error("Share canceled"));
    await expect(shareSettingsExport("{}", "s.json")).resolves.toBe(false);
  });

  it("reports a share that genuinely failed", async () => {
    native.share.mockRejectedValue(new Error("No activity found"));
    await expect(shareSettingsExport("{}", "s.json")).rejects.toThrow("No activity found");
  });

  it("downloads the file in a browser", async () => {
    native.isNative = false;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => "blob:settings");
    URL.revokeObjectURL = vi.fn();

    await expect(shareSettingsExport("{}", "s.json")).resolves.toBe(true);

    expect(click).toHaveBeenCalledTimes(1);
    expect(native.share).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

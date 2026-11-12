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

import { isShareCancelled, shareFile, shareSettingsExport } from "@/lib/config/settingsExportShare";

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

describe("sharing a binary file", () => {
  beforeEach(() => {
    native.isNative = true;
    native.writeFile.mockReset().mockResolvedValue(undefined);
    native.getUri.mockReset().mockResolvedValue({ uri: "file:///cache/shot.png" });
    native.share.mockReset().mockResolvedValue(undefined);
  });

  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

  it("writes the bytes as base64, without a text encoding, and shares the file by URI on a phone", async () => {
    await expect(
      shareFile({ filename: "shot.png", title: "C64 screenshot", mimeType: "image/png", content: png() }),
    ).resolves.toBe("shared");

    expect(native.writeFile).toHaveBeenCalledTimes(1);
    const written = native.writeFile.mock.calls[0][0];
    expect(written).toEqual({ path: "shot.png", data: "iVBORw==", directory: "CACHE" });
    expect(native.share).toHaveBeenCalledWith({ title: "C64 screenshot", files: ["file:///cache/shot.png"] });
  });

  it("reports a dismissed share sheet as cancelled", async () => {
    native.share.mockRejectedValue(new Error("Share canceled"));

    await expect(shareFile({ filename: "shot.png", title: "t", mimeType: "image/png", content: png() })).resolves.toBe(
      "cancelled",
    );
  });

  it("downloads the blob itself, under its own name, in a browser", async () => {
    native.isNative = false;
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const content = png();
    URL.createObjectURL = vi.fn(() => "blob:shot");
    URL.revokeObjectURL = vi.fn();

    await expect(shareFile({ filename: "shot.png", title: "t", mimeType: "image/png", content })).resolves.toBe(
      "downloaded",
    );

    expect(URL.createObjectURL).toHaveBeenCalledWith(content);
    expect(clicked).toEqual(["shot.png"]);
    expect(native.writeFile).not.toHaveBeenCalled();
    click.mockRestore();
  });
});

describe("isShareCancelled", () => {
  it.each(["Share canceled", "Share cancelled", "share CANCELED"])(
    "recognises %j as a dismissed share sheet",
    (message) => {
      expect(isShareCancelled(new Error(message))).toBe(true);
    },
  );

  it.each([
    ["another error", new Error("No activity found")],
    ["a longer message that only contains the words", new Error("Share canceled by policy")],
    ["an error without a message", new Error()],
    ["a rejection that is not an Error", "Share canceled"],
    ["undefined", undefined],
    ["null", null],
  ])("does not take %s for a dismissal", (_name, error) => {
    expect(isShareCancelled(error)).toBe(false);
  });
});

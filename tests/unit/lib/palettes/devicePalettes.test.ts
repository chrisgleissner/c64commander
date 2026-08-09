/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listFtpDirectory: vi.fn(),
  makeFtpDirectory: vi.fn(),
  readFtpFile: vi.fn(),
  writeFtpFile: vi.fn(),
  resolveFtpConnectionOptions: vi.fn(),
  setConfigValue: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: mocks.listFtpDirectory,
  makeFtpDirectory: mocks.makeFtpDirectory,
  readFtpFile: mocks.readFtpFile,
  writeFtpFile: mocks.writeFtpFile,
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  resolveFtpConnectionOptions: mocks.resolveFtpConnectionOptions,
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ setConfigValue: mocks.setConfigValue }),
}));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
  addErrorLog: vi.fn(),
}));

import { VIC_PALETTES } from "@/generated/vicPalettes";
import {
  DEVICE_PALETTE_DIRECTORY,
  applyPaletteToDevice,
  devicePaletteFileName,
  devicePaletteFilePath,
  formatVpl,
  installPaletteOnDevice,
  isFirmwareDefaultPalette,
  readDevicePalette,
  readDevicePaletteFilename,
  readDevicePaletteFilenames,
} from "@/lib/palettes/devicePalettes";
import { parseVpl } from "@/lib/streams/vpl";

const PALETTE_CATEGORY = "U64 Specific Settings";
const PALETTE_ITEM = "Palette Definition";

const byId = (id: string) => VIC_PALETTES.find((palette) => palette.id === id)!;

const wrapped = (item: unknown) => ({ [PALETTE_CATEGORY]: { items: { [PALETTE_ITEM]: item } } });

describe("devicePalettes", () => {
  beforeEach(() => {
    mocks.resolveFtpConnectionOptions.mockResolvedValue({ host: "c64u", port: 21, username: "user", password: "" });
    mocks.listFtpDirectory.mockResolvedValue({ entries: [] });
    mocks.makeFtpDirectory.mockResolvedValue({ created: true });
    mocks.writeFtpFile.mockResolvedValue({ sizeBytes: 442 });
    mocks.setConfigValue.mockResolvedValue({ errors: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("file naming", () => {
    it("puts a bare device file name under the machine's palette folder", () => {
      expect(devicePaletteFilePath("mine.vpl")).toBe(`${DEVICE_PALETTE_DIRECTORY}/mine.vpl`);
    });

    it("does not double the separator for a value that arrives with one", () => {
      expect(devicePaletteFilePath("/mine.vpl")).toBe(`${DEVICE_PALETTE_DIRECTORY}/mine.vpl`);
    });

    it("names a built-in palette's file after its id", () => {
      expect(devicePaletteFileName(byId("neonblast"))).toBe("neonblast.vpl");
    });

    it("treats only Default as the palette the machine already has", () => {
      expect(isFirmwareDefaultPalette(byId("default"))).toBe(true);
      expect(isFirmwareDefaultPalette(byId("neonblast"))).toBe(false);
    });
  });

  describe("formatVpl", () => {
    it("round-trips through the parser the machine's format is shared with", () => {
      const source = byId("neonblast");
      const parsed = parseVpl(formatVpl(source), "round-trip");
      expect(parsed.name).toBe(source.name);
      expect(parsed.description).toBe(source.description);
      expect(parsed.rgb).toEqual(source.rgb);
    });

    it("writes two upper-case hex digits per channel, as VICE files do", () => {
      const black = formatVpl(byId("default"))
        .split("\n")
        .find((line) => /^[0-9A-F]{2} /.test(line));
      expect(black).toBe("00 00 00");
      expect(formatVpl(byId("default"))).toContain("F7 F7 F7");
    });

    it("round-trips every palette the app ships", () => {
      VIC_PALETTES.forEach((palette) => {
        expect(parseVpl(formatVpl(palette), palette.id).rgb).toEqual(palette.rgb);
      });
    });
  });

  describe("reading what the machine reports", () => {
    it("reads the selected file name from an items-wrapped response", () => {
      expect(readDevicePaletteFilename(wrapped({ current: "mine.vpl" }))).toBe("mine.vpl");
    });

    it("reads the selected file name from a response without an items wrapper", () => {
      expect(readDevicePaletteFilename({ [PALETTE_CATEGORY]: { [PALETTE_ITEM]: { current: "flat.vpl" } } })).toBe(
        "flat.vpl",
      );
    });

    it("trims the value, because a padded name would not resolve to a file", () => {
      expect(readDevicePaletteFilename(wrapped({ current: "  spaced.vpl  " }))).toBe("spaced.vpl");
    });

    it.each([
      ["nothing at all", undefined],
      ["a non-object", "nonsense"],
      ["a response without the category", { Other: {} }],
      ["a category that is not an object", { [PALETTE_CATEGORY]: "nope" }],
    ])("reports the built-in palette for %s", (_label, response) => {
      expect(readDevicePaletteFilename(response)).toBe("");
    });

    it("lists the installed files and drops the empty built-in entry", () => {
      expect(readDevicePaletteFilenames(wrapped({ current: "", presets: ["", "a.vpl", "b.vpl"] }))).toEqual([
        "a.vpl",
        "b.vpl",
      ]);
    });

    it("lists nothing when the item reports no presets", () => {
      expect(readDevicePaletteFilenames(wrapped({ current: "" }))).toEqual([]);
    });

    it.each([
      ["nothing at all", undefined],
      ["a non-object", 42],
      ["a response without the category", { Other: {} }],
      ["a category that is not an object", { [PALETTE_CATEGORY]: null }],
      ["a category without the item", { [PALETTE_CATEGORY]: { items: {} } }],
    ])("lists nothing for %s", (_label, response) => {
      expect(readDevicePaletteFilenames(response)).toEqual([]);
    });
  });

  describe("readDevicePalette", () => {
    it("reads the named file from the machine's palette folder and parses it", async () => {
      mocks.readFtpFile.mockResolvedValue({ data: btoa(formatVpl(byId("warm"))) });

      const palette = await readDevicePalette("warm.vpl");

      expect(mocks.readFtpFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${DEVICE_PALETTE_DIRECTORY}/warm.vpl`, __c64uIntent: "background" }),
      );
      expect(palette.rgb).toEqual(byId("warm").rgb);
      expect(palette.id).toBe("device:warm.vpl");
    });
  });

  describe("installPaletteOnDevice", () => {
    it("uploads the palette into the folder the machine reads", async () => {
      const filename = await installPaletteOnDevice(byId("night"));

      expect(filename).toBe("night.vpl");
      expect(mocks.writeFtpFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${DEVICE_PALETTE_DIRECTORY}/night.vpl` }),
      );
      const written = mocks.writeFtpFile.mock.calls[0]![0].data as string;
      expect(parseVpl(atob(written), "uploaded").rgb).toEqual(byId("night").rgb);
    });

    it("does not create the folder when it is already there", async () => {
      await installPaletteOnDevice(byId("night"));
      expect(mocks.makeFtpDirectory).not.toHaveBeenCalled();
    });

    it("creates the folder first when the machine has never had a palette", async () => {
      // The firmware only creates /flash/data when a palette is applied from its own file browser,
      // and an upload into a missing directory fails outright rather than creating it.
      mocks.listFtpDirectory.mockRejectedValue(new Error("no such directory"));

      await installPaletteOnDevice(byId("night"));

      expect(mocks.makeFtpDirectory).toHaveBeenCalledWith(expect.objectContaining({ path: DEVICE_PALETTE_DIRECTORY }));
      expect(mocks.makeFtpDirectory.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.writeFtpFile.mock.invocationCallOrder[0]!,
      );
    });

    it("skips the upload when the machine already lists that file", async () => {
      const filename = await installPaletteOnDevice(byId("night"), ["night.vpl"]);

      expect(filename).toBe("night.vpl");
      expect(mocks.writeFtpFile).not.toHaveBeenCalled();
      expect(mocks.listFtpDirectory).not.toHaveBeenCalled();
    });

    it("refuses a file name the machine would truncate", async () => {
      const tooLong = { ...byId("night"), id: "a".repeat(28) };

      await expect(installPaletteOnDevice(tooLong)).rejects.toThrow(/longer than the 30 characters/);
      expect(mocks.writeFtpFile).not.toHaveBeenCalled();
    });
  });

  describe("applyPaletteToDevice", () => {
    it("selects the empty value for Default rather than uploading a copy of the built-in palette", async () => {
      const value = await applyPaletteToDevice(byId("default"));

      expect(value).toBe("");
      expect(mocks.writeFtpFile).not.toHaveBeenCalled();
      expect(mocks.setConfigValue).toHaveBeenCalledWith(PALETTE_CATEGORY, PALETTE_ITEM, "");
    });

    it("installs and then selects any other palette", async () => {
      const value = await applyPaletteToDevice(byId("cool"));

      expect(value).toBe("cool.vpl");
      expect(mocks.writeFtpFile).toHaveBeenCalled();
      expect(mocks.setConfigValue).toHaveBeenCalledWith(PALETTE_CATEGORY, PALETTE_ITEM, "cool.vpl");
      expect(mocks.writeFtpFile.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.setConfigValue.mock.invocationCallOrder[0]!,
      );
    });

    it("does not select anything when the upload failed", async () => {
      mocks.writeFtpFile.mockRejectedValue(new Error("FTP write failed"));

      await expect(applyPaletteToDevice(byId("cool"))).rejects.toThrow("FTP write failed");
      expect(mocks.setConfigValue).not.toHaveBeenCalled();
    });
  });
});

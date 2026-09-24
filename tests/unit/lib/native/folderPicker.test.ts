/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FolderPicker, canPickDocuments, resetDocumentPickerSupport } from "@/lib/native/folderPicker";
import { getPlatform } from "@/lib/native/platform";
import { addLog } from "@/lib/logging";

// Mock getPlatform to allow testing both android and web paths
vi.mock("@/lib/native/platform", () => ({
  getPlatform: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

// Mock the Capacitor plugin registration using vi.hoisted to resolve reference error
const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  pickFile: vi.fn(),
  listChildren: vi.fn(),
  getPersistedUris: vi.fn(),
  releasePersistedUris: vi.fn(),
  readFile: vi.fn(),
  readFileFromTree: vi.fn(),
  canPickDocuments: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    pickDirectory: mocks.pickDirectory,
    pickFile: mocks.pickFile,
    listChildren: mocks.listChildren,
    getPersistedUris: mocks.getPersistedUris,
    releasePersistedUris: mocks.releasePersistedUris,
    readFile: mocks.readFile,
    readFileFromTree: mocks.readFileFromTree,
    canPickDocuments: mocks.canPickDocuments,
  }),
}));

describe("FolderPicker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();

    // Reset specific mocks in the hoisted object
    mocks.pickDirectory.mockReset();
    mocks.pickFile.mockReset();
    mocks.listChildren.mockReset();
    mocks.getPersistedUris.mockReset();
    mocks.releasePersistedUris.mockReset();
    mocks.readFile.mockReset();
    mocks.readFileFromTree.mockReset();
  });

  afterEach(() => {
    const win = window as any;
    delete win.__c64uFolderPickerOverride;
    delete win.__c64uAllowAndroidFolderPickerOverride;
  });

  it("delegates to plugin by default", async () => {
    mocks.pickDirectory.mockResolvedValue({ uri: "content://foo" });

    const result = await FolderPicker.pickDirectory();

    expect(mocks.pickDirectory).toHaveBeenCalled();
    expect(result.uri).toBe("content://foo");
  });

  describe("Android Override Protection", () => {
    it("allows override on non-android platforms", async () => {
      vi.mocked(getPlatform).mockReturnValue("web");
      const overridePick = vi.fn().mockResolvedValue({ uri: "overridden" });

      const win = window as any;
      win.__c64uFolderPickerOverride = {
        pickDirectory: overridePick,
      };

      const result = await FolderPicker.pickDirectory();
      expect(result.uri).toBe("overridden");
      expect(mocks.pickDirectory).not.toHaveBeenCalled();
    });

    it("blocks override on android by default", async () => {
      vi.mocked(getPlatform).mockReturnValue("android");
      const overridePick = vi.fn().mockResolvedValue({ uri: "overridden" });

      const win = window as any;
      win.__c64uFolderPickerOverride = {
        pickDirectory: overridePick,
      };

      expect(() => FolderPicker.pickDirectory()).toThrow("Android SAF picker is required");
    });

    it("allows override on android if enabled via probe", async () => {
      vi.mocked(getPlatform).mockReturnValue("android");
      vi.stubEnv("VITE_ENABLE_TEST_PROBES", "1");

      const overridePick = vi.fn().mockResolvedValue({ uri: "overridden" });

      const win = window as any;
      win.__c64uFolderPickerOverride = {
        pickDirectory: overridePick,
      };
      win.__c64uAllowAndroidFolderPickerOverride = true;

      const result = await FolderPicker.pickDirectory();
      expect(result.uri).toBe("overridden");
    });
  });

  it("calls all proxy methods", async () => {
    // smoke test other methods
    await FolderPicker.pickFile();
    expect(mocks.pickFile).toHaveBeenCalled();

    await FolderPicker.listChildren({ treeUri: "" });
    expect(mocks.listChildren).toHaveBeenCalled();

    await FolderPicker.getPersistedUris();
    expect(mocks.getPersistedUris).toHaveBeenCalled();

    await FolderPicker.releasePersistedUris();
    expect(mocks.releasePersistedUris).toHaveBeenCalled();

    await FolderPicker.readFile({ uri: "" });
    expect(mocks.readFile).toHaveBeenCalled();

    await FolderPicker.readFileFromTree({ treeUri: "", path: "" });
    expect(mocks.readFileFromTree).toHaveBeenCalled();
  });

  describe("canPickDocuments", () => {
    beforeEach(() => {
      resetDocumentPickerSupport();
    });

    it("logs a failed support check at warn and asks the plugin again on the next call", async () => {
      vi.mocked(getPlatform).mockReturnValue("android");
      mocks.canPickDocuments
        .mockRejectedValueOnce(new Error("plugin bridge busy"))
        .mockResolvedValueOnce({ directories: false, files: true });

      await expect(canPickDocuments()).resolves.toEqual({ directories: true, files: true });
      expect(addLog).toHaveBeenCalledWith(
        "warn",
        "Document picker support check failed; offering local sources anyway",
        { error: "plugin bridge busy" },
      );

      await expect(canPickDocuments()).resolves.toEqual({ directories: false, files: true });
      expect(mocks.canPickDocuments).toHaveBeenCalledTimes(2);
    });

    it("answers yes on the web build without calling the plugin", async () => {
      vi.mocked(getPlatform).mockReturnValue("web");

      await expect(canPickDocuments()).resolves.toEqual({ directories: true, files: true });
      expect(mocks.canPickDocuments).not.toHaveBeenCalled();
      expect(addLog).not.toHaveBeenCalled();
    });
  });
});

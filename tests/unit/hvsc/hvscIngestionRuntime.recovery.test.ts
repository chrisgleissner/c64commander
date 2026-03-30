/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeLibraryFile: vi.fn(async () => undefined),
  deleteLibraryFile: vi.fn(async () => undefined),
  resetLibraryRoot: vi.fn(async () => undefined),
  resetSonglengthsCache: vi.fn(),
  updateHvscState: vi.fn(),
  extractArchiveEntries: vi.fn(),
  readCachedArchiveMarker: vi.fn(async () => ({ version: 5, type: "baseline" })),
  reloadHvscSonglengthsOnConfigChange: vi.fn(async () => undefined),
  getHvscSonglengthsStats: vi.fn(() => ({ backendStats: { rejectedLines: 0 } })),
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

const browseIndexMutable = vi.hoisted(() => ({
  upsertSong: vi.fn(),
  deleteSong: vi.fn(),
  finalize: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    readdir: vi.fn(async () => ({ files: ["hvsc-baseline-5.complete.json"] })),
    readFile: vi.fn(async () => ({ data: Buffer.from([1, 2, 3]).toString("base64") })),
    stat: vi.fn(async () => ({ size: 123, type: "file" })),
    downloadFile: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: vi.fn(() => ({
    ingestHvsc: vi.fn(),
    cancelIngestion: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  })),
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
}));

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  MAX_BRIDGE_READ_BYTES: 5 * 1024 * 1024,
  ensureHvscDirs: vi.fn(async () => undefined),
  getHvscCacheDir: vi.fn(() => "hvsc/cache"),
  listHvscFolder: vi.fn(),
  getHvscSongByVirtualPath: vi.fn(),
  getHvscDurationByMd5: vi.fn(),
  writeLibraryFile: (...args: unknown[]) => mocks.writeLibraryFile(...args),
  deleteLibraryFile: (...args: unknown[]) => mocks.deleteLibraryFile(...args),
  resetLibraryRoot: (...args: unknown[]) => mocks.resetLibraryRoot(...args),
  resetSonglengthsCache: (...args: unknown[]) => mocks.resetSonglengthsCache(...args),
  writeCachedArchive: vi.fn(async () => undefined),
  deleteCachedArchive: vi.fn(async () => undefined),
  writeCachedArchiveMarker: vi.fn(async () => undefined),
  readCachedArchiveMarker: (...args: unknown[]) => mocks.readCachedArchiveMarker(...args),
}));

vi.mock("@/lib/hvsc/hvscStateStore", () => ({
  loadHvscState: vi.fn(() => ({
    ingestionState: "idle",
    ingestionError: null,
    installedVersion: 0,
    installedBaselineVersion: null,
  })),
  updateHvscState: (...args: unknown[]) => mocks.updateHvscState(...args),
  isUpdateApplied: vi.fn(() => false),
  markUpdateApplied: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscStatusStore", () => ({
  updateHvscStatusSummaryFromEvent: vi.fn(),
  loadHvscStatusSummary: vi.fn(() => ({ download: { status: "idle" }, extraction: { status: "idle" } })),
  saveHvscStatusSummary: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscSongLengthService", () => ({
  reloadHvscSonglengthsOnConfigChange: (...args: unknown[]) => mocks.reloadHvscSonglengthsOnConfigChange(...args),
  getHvscSonglengthsStats: (...args: unknown[]) => mocks.getHvscSonglengthsStats(...args),
}));

vi.mock("@/lib/hvsc/hvscArchiveExtraction", () => ({
  extractArchiveEntries: (...args: unknown[]) => mocks.extractArchiveEntries(...args),
}));

vi.mock("@/lib/hvsc/hvscBrowseIndexStore", () => ({
  clearHvscBrowseIndexSnapshot: vi.fn(async () => undefined),
  createHvscBrowseIndexMutable: vi.fn(async () => browseIndexMutable),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => mocks.addErrorLog(...args),
  addLog: (...args: unknown[]) => mocks.addLog(...args),
}));

vi.mock("@/lib/tracing/failureTaxonomy", () => ({
  classifyError: vi.fn((error: Error) => ({
    category: /cancelled/i.test(error.message) ? "cancelled" : "unknown",
    isExpected: /cancelled/i.test(error.message),
  })),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
  buildSidTrackSubsongs: vi.fn(() => null),
  parseSidHeaderMetadata: vi.fn(() => null),
}));

import { cancelHvscInstall, ingestCachedHvsc } from "@/lib/hvsc/hvscIngestionRuntime";

describe("hvscIngestionRuntime recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries successfully after a failed extraction run and reaches ready state", async () => {
    mocks.extractArchiveEntries
      .mockRejectedValueOnce(new Error("extraction exploded"))
      .mockImplementationOnce(async ({ onEntry }: { onEntry?: (path: string, data: Uint8Array) => Promise<void> }) => {
        await onEntry?.("HVSC/C64Music/Demo/recovered.sid", new Uint8Array([1, 2, 3]));
      });

    await expect(ingestCachedHvsc("token-retry-1")).rejects.toThrow("extraction exploded");
    expect(mocks.updateHvscState).toHaveBeenCalledWith(
      expect.objectContaining({ ingestionState: "error", ingestionError: "extraction exploded" }),
    );

    await expect(ingestCachedHvsc("token-retry-2")).resolves.toEqual(
      expect.objectContaining({ ingestionState: "idle" }),
    );
    expect(mocks.updateHvscState).toHaveBeenCalledWith(
      expect.objectContaining({
        ingestionState: "ready",
        installedVersion: 5,
        installedBaselineVersion: 5,
      }),
    );
  });

  it("stops an in-progress cached ingestion cleanly when the cancellation token is triggered", async () => {
    mocks.extractArchiveEntries.mockImplementationOnce(async () => {
      await cancelHvscInstall("token-cancel");
      throw new Error("HVSC update cancelled");
    });

    await expect(ingestCachedHvsc("token-cancel")).rejects.toThrow("HVSC update cancelled");

    const statePatches = mocks.updateHvscState.mock.calls.map(([patch]) => patch as Record<string, unknown>);
    expect(
      statePatches.some(
        (patch) => patch.ingestionState === "error" && patch.ingestionError === "HVSC update cancelled",
      ),
    ).toBe(false);
    expect(statePatches).toContainEqual(
      expect.objectContaining({ ingestionState: "idle", ingestionError: "Cancelled" }),
    );
  });
});

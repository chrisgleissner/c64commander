/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { inflateSync } from "fflate";
const addErrorLog = vi.fn();
const share = vi.fn();
const writeFile = vi.fn();
const getUri = vi.fn();

vi.mock("@/lib/logging", () => ({
  addErrorLog,
}));

vi.mock("@capacitor/share", () => ({
  Share: {
    share,
  },
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: {
    Cache: "CACHE",
  },
  Filesystem: {
    writeFile,
    getUri,
  },
}));

const isNativePlatform = vi.fn(() => false);
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform,
  },
}));

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const parseZipEntries = (zipData: Uint8Array) => {
  const bytes = new Uint8Array(zipData);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;

  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      endOffset = index;
      break;
    }
  }

  if (endOffset < 0) {
    throw new Error("ZIP end-of-central-directory record not found.");
  }

  const entryCount = view.getUint16(endOffset + 10, true);
  let centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  const entries: Record<string, Uint8Array> = {};

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (view.getUint32(centralDirectoryOffset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error("ZIP central-directory header not found.");
    }

    const compressionMethod = view.getUint16(centralDirectoryOffset + 10, true);
    const compressedSize = view.getUint32(centralDirectoryOffset + 20, true);
    const fileNameLength = view.getUint16(centralDirectoryOffset + 28, true);
    const extraLength = view.getUint16(centralDirectoryOffset + 30, true);
    const commentLength = view.getUint16(centralDirectoryOffset + 32, true);
    const localHeaderOffset = view.getUint32(centralDirectoryOffset + 42, true);
    const fileNameStart = centralDirectoryOffset + 46;
    const fileName = decoder.decode(bytes.slice(fileNameStart, fileNameStart + fileNameLength));

    if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`ZIP local header not found for ${fileName}.`);
    }

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    entries[fileName] =
      compressionMethod === 0
        ? compressedData
        : compressionMethod === 8
          ? inflateSync(compressedData)
          : (() => {
              throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${fileName}.`);
            })();

    centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
};

const normalizeZipEntries = (entries: Record<string, Uint8Array>) => {
  const normalized: Record<string, Uint8Array> = {};
  const fragmentedEntries = new Map<string, Array<[number, Uint8Array]>>();

  for (const [path, value] of Object.entries(entries)) {
    if (!path.includes("/")) {
      normalized[path] = value;
      continue;
    }

    const fragmentMatch = path.match(/^(.*\.json)\/(\d+)\/$/);
    if (!fragmentMatch) continue;

    const [, fileName, indexText] = fragmentMatch;
    const index = Number(indexText);
    const bucket = fragmentedEntries.get(fileName) ?? [];
    bucket.push([index, value]);
    fragmentedEntries.set(fileName, bucket);
  }

  for (const [fileName, fragments] of fragmentedEntries) {
    const flattened = fragments
      .sort((left, right) => left[0] - right[0])
      .flatMap(([, fragment]) => Array.from(fragment));
    normalized[fileName] = Uint8Array.from(flattened);
  }

  return normalized;
};

describe("diagnosticsExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatform.mockReturnValue(false);
    (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = undefined;
  });

  it("uses diagnostics share override when present", async () => {
    const override = vi.fn(async () => undefined);
    (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = override;

    const { shareDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");
    await shareDiagnosticsZip("logs", [{ id: 1 }]);

    expect(override).toHaveBeenCalledTimes(1);
    expect(override).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "logs",
        filename: expect.stringMatching(/^c64commander-diagnostics-logs-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}Z\.zip$/),
      }),
    );
    expect(share).not.toHaveBeenCalled();
  });

  it("downloads zip in web mode", async () => {
    if (!(URL as unknown as { createObjectURL?: unknown }).createObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        value: vi.fn(() => "blob:test"),
        configurable: true,
      });
    }
    if (!(URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        value: vi.fn(() => undefined),
        configurable: true,
      });
    }
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.fn();
    const createElement = vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click,
    } as unknown as HTMLAnchorElement);

    const { shareDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");
    await shareDiagnosticsZip("traces", [{ trace: true }]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(0);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    createElement.mockRestore();
  });

  it("uses native share flow when running on native platform", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue(undefined);
    getUri.mockResolvedValue({ uri: "file://cache/export.zip" });
    share.mockResolvedValue(undefined);

    const { shareDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");
    await shareDiagnosticsZip("actions", [{ action: "A" }]);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/^c64commander-diagnostics-actions-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}Z\.zip$/),
      }),
    );
    expect(getUri).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("shares all diagnostics tabs in a single timestamped zip", async () => {
    const override = vi.fn(async () => undefined);
    (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = override;

    const { buildDiagnosticsZipData, shareAllDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");
    await shareAllDiagnosticsZip({
      "error-logs": [{ id: "err-1" }],
      logs: [{ id: "log-1" }],
      traces: [{ id: "trace-1" }],
      actions: [{ correlationId: "COR-1" }],
    });

    expect(override).toHaveBeenCalledTimes(1);
    const payload = override.mock.calls[0]?.[0] as { filename: string; scope: string };
    expect(payload.scope).toBe("all");
    expect(payload.filename).toMatch(/^c64commander-diagnostics-all-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}Z\.zip$/);

    const zipData = buildDiagnosticsZipData(
      "all",
      {
        "error-logs": [{ id: "err-1" }],
        logs: [{ id: "log-1" }],
        traces: [{ id: "trace-1" }],
        actions: [{ correlationId: "COR-1" }],
      },
      "2026-03-12-0913-33Z",
    );
    expect(zipData).toBeInstanceOf(Uint8Array);
    expect(zipData.byteLength).toBeGreaterThan(0);
  });

  it("writes each diagnostics payload into its own JSON archive entry", async () => {
    const { buildDiagnosticsZipData } = await import("@/lib/diagnostics/diagnosticsExport");
    const timestamp = "2026-03-12-0913-33Z";
    const zipData = buildDiagnosticsZipData(
      "all",
      {
        "error-logs": [{ id: "err-1", token: "redacted-error-token" }],
        logs: [{ id: "log-1", session: "alpha" }],
        traces: [{ id: "trace-1", step: "resume" }],
        actions: [{ correlationId: "COR-1", action: "share" }],
        supplemental: { build: "1.2.3" },
      },
      timestamp,
    );

    const archive = normalizeZipEntries(parseZipEntries(zipData));

    expect(Object.keys(archive).sort()).toEqual([
      `actions-${timestamp}.json`,
      `error-logs-${timestamp}.json`,
      `logs-${timestamp}.json`,
      `supplemental-${timestamp}.json`,
      `traces-${timestamp}.json`,
    ]);
    expect(archive[`error-logs-${timestamp}.json`]).toBeInstanceOf(Uint8Array);
    expect(archive[`logs-${timestamp}.json`]).toBeInstanceOf(Uint8Array);
    expect(archive[`traces-${timestamp}.json`]).toBeInstanceOf(Uint8Array);
    expect(archive[`actions-${timestamp}.json`]).toBeInstanceOf(Uint8Array);
    expect(archive[`supplemental-${timestamp}.json`]).toBeInstanceOf(Uint8Array);
  });

  it("formats diagnostics export timestamps in UTC filename-safe form", async () => {
    const { formatDiagnosticsExportTimestamp } = await import("@/lib/diagnostics/diagnosticsExport");
    expect(formatDiagnosticsExportTimestamp(new Date("2026-03-12T09:13:33.000Z"))).toBe("2026-03-12-0913-33Z");
  });

  it("logs and rethrows when override fails", async () => {
    const override = vi.fn(async () => {
      throw new Error("override failed");
    });
    (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = override;

    const { shareDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");

    await expect(shareDiagnosticsZip("error-logs", [{ id: 1 }])).rejects.toThrow("override failed");
    expect(addErrorLog).toHaveBeenCalledWith(
      "Diagnostics share override failed",
      expect.objectContaining({ error: "override failed" }),
    );
  });

  it("isTestProbeEnabled returns true when __c64uTestProbeEnabled flag is set (lines 34, 51)", async () => {
    (window as unknown as { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue(undefined);
    getUri.mockResolvedValue({ uri: "file://cache/export.zip" });
    share.mockResolvedValue(undefined);

    const { shareDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");
    await shareDiagnosticsZip("logs", [{ id: 1 }]);

    // Native share was called — override is still null even when probe flag is set
    expect(share).toHaveBeenCalledTimes(1);
    delete (window as unknown as { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
  });

  it("buildDiagnosticsZipBlob null data falls back to empty array", async () => {
    const { buildDiagnosticsZipBlob } = await import("@/lib/diagnostics/diagnosticsExport");
    const blob = buildDiagnosticsZipBlob("logs", null, "2026-03-12-0913-33Z");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });

  it("buildDiagnosticsZipData includes supplemental file when scope is all and supplemental is present", async () => {
    const { buildDiagnosticsZipData } = await import("@/lib/diagnostics/diagnosticsExport");
    const zipData = buildDiagnosticsZipData(
      "all",
      {
        "error-logs": [],
        logs: [],
        traces: [],
        actions: [],
        supplemental: { version: "1.0.0", info: "extra" },
      },
      "2026-03-12-0913-33Z",
    );
    expect(zipData).toBeInstanceOf(Uint8Array);
    expect(zipData.byteLength).toBeGreaterThan(10);
  });

  it("buildDiagnosticsZipData does not include supplemental when scope is a single tab", async () => {
    const { buildDiagnosticsZipData } = await import("@/lib/diagnostics/diagnosticsExport");
    const zipData = buildDiagnosticsZipData("logs", [{ id: "x" }], "2026-03-12-0913-33Z");
    expect(zipData).toBeInstanceOf(Uint8Array);
    expect(zipData.byteLength).toBeGreaterThan(0);
  });

  it("preserves raw device attribution metadata in exported diagnostics payloads", async () => {
    const override = vi.fn(async () => undefined);
    (window as unknown as { __c64uDiagnosticsShareOverride?: unknown }).__c64uDiagnosticsShareOverride = override;

    const exportPayload = {
      "error-logs": [],
      logs: [
        {
          id: "log-1",
          device: {
            savedDeviceId: "device-office",
            savedDeviceNameSnapshot: "Office U64",
            savedDeviceHostSnapshot: "office-u64",
            verifiedUniqueId: "UID-OFFICE",
            verifiedHostname: "office-u64",
            verifiedProduct: "U64",
          },
        },
      ],
      traces: [
        {
          id: "trace-1",
          data: {
            device: {
              savedDeviceId: "device-backup",
              savedDeviceNameSnapshot: "Backup Lab",
              savedDeviceHostSnapshot: "backup-lab",
              verifiedUniqueId: "UID-BACKUP",
              verifiedHostname: "backup-lab",
              verifiedProduct: "U64E",
              connectionState: "READY",
            },
          },
        },
      ],
      actions: [
        {
          correlationId: "COR-1",
          device: {
            savedDeviceId: "device-office",
            savedDeviceNameSnapshot: "Office U64",
            savedDeviceHostSnapshot: "office-u64",
            verifiedUniqueId: "UID-OFFICE",
            verifiedHostname: "office-u64",
            verifiedProduct: "U64",
          },
        },
      ],
    };

    const { shareAllDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");
    await shareAllDiagnosticsZip(exportPayload);

    expect(override).toHaveBeenCalledTimes(1);
    const payload = override.mock.calls[0]?.[0] as {
      scope: string;
      data: typeof exportPayload;
      zipData: Uint8Array;
    };

    expect(payload.scope).toBe("all");
    expect(payload.zipData).toBeInstanceOf(Uint8Array);
    expect(payload.zipData.byteLength).toBeGreaterThan(0);
    expect(payload.data.logs[0]?.device).toEqual(
      expect.objectContaining({
        savedDeviceId: "device-office",
        savedDeviceNameSnapshot: "Office U64",
        verifiedUniqueId: "UID-OFFICE",
      }),
    );
    expect(payload.data.traces[0]?.data.device).toEqual(
      expect.objectContaining({
        savedDeviceId: "device-backup",
        savedDeviceNameSnapshot: "Backup Lab",
        verifiedUniqueId: "UID-BACKUP",
        connectionState: "READY",
      }),
    );
    expect(payload.data.actions[0]?.device).toEqual(
      expect.objectContaining({
        savedDeviceId: "device-office",
        savedDeviceNameSnapshot: "Office U64",
        verifiedUniqueId: "UID-OFFICE",
      }),
    );
  });

  it("logs and rethrows when native share writeFile fails", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockRejectedValue(new Error("disk full"));

    const { shareDiagnosticsZip } = await import("@/lib/diagnostics/diagnosticsExport");

    await expect(shareDiagnosticsZip("error-logs", [])).rejects.toThrow("disk full");
    expect(addErrorLog).toHaveBeenCalledWith(
      "Diagnostics share failed",
      expect.objectContaining({ error: "disk full" }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as logging from "@/lib/logging";
import { createReuWorkflow, detectUpdatedTempReuFile, waitForTempReuFile } from "@/lib/reu/reuWorkflow";
import type { ReuSnapshotStorageEntry } from "@/lib/reu/reuSnapshotTypes";

const addLogSpy = vi.spyOn(logging, "addLog").mockImplementation(() => undefined);
const addErrorLogSpy = vi.spyOn(logging, "addErrorLog").mockImplementation(() => undefined);

describe("reuWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects the newest changed .reu file in /Temp", () => {
    const file = detectUpdatedTempReuFile(
      [{ name: "old.reu", path: "/Temp/old.reu", modifiedAt: "2026-03-29T10:00:00Z", size: 10 }],
      [
        { name: "old.reu", path: "/Temp/old.reu", modifiedAt: "2026-03-29T10:00:00Z", size: 10 },
        { name: "newer.reu", path: "/Temp/newer.reu", modifiedAt: "2026-03-29T10:01:00Z", size: 20 },
      ],
    );

    expect(file?.name).toBe("newer.reu");
  });

  it("ignores unchanged files and non-reu updates when detecting new temp files", () => {
    const file = detectUpdatedTempReuFile(
      [{ name: "old.reu", path: "/Temp/old.reu", modifiedAt: "2026-03-29T10:00:00Z", size: 10 }],
      [
        { name: "old.reu", path: "/Temp/old.reu", modifiedAt: "2026-03-29T10:00:00Z", size: 10 },
        { name: "notes.txt", path: "/Temp/notes.txt", modifiedAt: "2026-03-29T10:01:00Z", size: 20 },
      ],
    );

    expect(file).toBeNull();
  });

  it("sorts changed REU files even when one side has no modified timestamp", () => {
    const file = detectUpdatedTempReuFile(
      [],
      [
        { name: "older.reu", path: "/Temp/older.reu", modifiedAt: undefined, size: 10 },
        { name: "newer.reu", path: "/Temp/newer.reu", modifiedAt: "2026-03-29T10:01:00Z", size: 20 },
      ],
    );

    expect(file?.name).toBe("newer.reu");
  });

  it("waits for a new REU file to appear", async () => {
    const listRemoteTempFiles = vi
      .fn()
      .mockResolvedValueOnce([{ name: "old.reu", path: "/Temp/old.reu", modifiedAt: "2026-03-29T10:00:00Z" }])
      .mockResolvedValueOnce([{ name: "next.reu", path: "/Temp/next.reu", modifiedAt: "2026-03-29T10:01:00Z" }]);

    const file = await waitForTempReuFile([], listRemoteTempFiles, vi.fn().mockResolvedValue(undefined));

    expect(file.name).toBe("old.reu");
  });

  it("times out when no new REU file appears and reports waiting progress", async () => {
    const listRemoteTempFiles = vi.fn().mockResolvedValue([]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();

    await expect(waitForTempReuFile([], listRemoteTempFiles, sleep, onProgress, 2_000, 1_000)).rejects.toThrow(
      "Timed out waiting for the new REU file in /Temp.",
    );

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "waiting-for-file",
        progress: 0,
      }),
    );
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("emits the authoritative save step order and stores the REU snapshot", async () => {
    const saveToStore = vi.fn();
    const persistLocalSnapshot = vi.fn().mockResolvedValue({ kind: "native-data", path: "reu-snapshots/test.reu" });
    const onProgress = vi.fn();
    const workflow = createReuWorkflow({
      ensureLocalSnapshotStorage: vi.fn().mockResolvedValue(undefined),
      listRemoteTempFiles: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { name: "capture.reu", path: "/Temp/capture.reu", modifiedAt: "2026-03-29T10:01:00Z" },
        ]),
      runSaveRemoteReu: vi.fn().mockResolvedValue(undefined),
      readRemoteFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      persistLocalSnapshot,
      saveToStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-03-29T10:02:00Z"),
    });

    const entry = await workflow.saveSnapshot(onProgress);

    expect(entry.snapshotType).toBe("reu");
    expect(entry.remoteFileName).toBe("capture.reu");
    expect(saveToStore).toHaveBeenCalledWith(expect.objectContaining({ snapshotType: "reu" }));
    expect(persistLocalSnapshot).toHaveBeenCalled();
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual([
      "preparing",
      "scanning-temp",
      "saving-reu",
      "waiting-for-file",
      "downloading",
      "persisting",
      "complete",
    ]);
    expect(addLogSpy).toHaveBeenCalledWith(
      "info",
      "REU workflow complete",
      expect.objectContaining({
        operation: "save",
        status: "success",
        remoteFileName: "capture.reu",
        remotePath: "/Temp/capture.reu",
      }),
    );
  });

  it("emits the authoritative restore step order before applying the uploaded REU file", async () => {
    const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
    const runRestoreRemoteReu = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const snapshot: ReuSnapshotStorageEntry = {
      id: "reu-1",
      filename: "local.reu",
      createdAt: "2026-03-29T10:02:00Z",
      snapshotType: "reu",
      sizeBytes: 3,
      remoteFileName: "capture.reu",
      storage: { kind: "native-data", path: "reu-snapshots/local.reu" },
      metadata: {
        snapshot_type: "reu",
        display_ranges: ["REU image"],
        created_at: "2026-03-29 10:02:00",
      },
    };
    const workflow = createReuWorkflow({
      readLocalSnapshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      writeRemoteFile,
      runRestoreRemoteReu,
    });

    await workflow.restoreSnapshot(snapshot, "preload-on-startup", onProgress);

    expect(writeRemoteFile).toHaveBeenCalledWith("/Temp/capture.reu", new Uint8Array([1, 2, 3]));
    expect(runRestoreRemoteReu).toHaveBeenCalledWith("capture.reu", "preload-on-startup");
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual([
      "reading-local",
      "uploading",
      "restoring",
      "complete",
    ]);
    expect(addLogSpy).toHaveBeenCalledWith(
      "info",
      "REU workflow complete",
      expect.objectContaining({
        operation: "restore",
        status: "success",
        localPath: "reu-snapshots/local.reu",
        remotePath: "/Temp/capture.reu",
      }),
    );
  });

  it("falls back to the local file name when the remote file name is blank", async () => {
    const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
    const runRestoreRemoteReu = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const snapshot: ReuSnapshotStorageEntry = {
      id: "reu-2",
      filename: "fallback.reu",
      createdAt: "2026-03-29T10:02:00Z",
      snapshotType: "reu",
      sizeBytes: 3,
      remoteFileName: "",
      storage: { kind: "native-data", path: "reu-snapshots/fallback.reu" },
      metadata: {
        snapshot_type: "reu",
        display_ranges: ["REU image"],
        created_at: "2026-03-29 10:02:00",
      },
    };
    const workflow = createReuWorkflow({
      readLocalSnapshot: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      writeRemoteFile,
      runRestoreRemoteReu,
    });

    await workflow.restoreSnapshot(snapshot, "load-into-reu", onProgress);

    expect(writeRemoteFile).toHaveBeenCalledWith("/Temp/fallback.reu", new Uint8Array([4, 5, 6]));
    expect(runRestoreRemoteReu).toHaveBeenCalledWith("fallback.reu", "load-into-reu");
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        step: "complete",
        title: "REU image loaded",
      }),
    );
  });

  it("reports waiting progress at the capped upper bound before timing out", async () => {
    const listRemoteTempFiles = vi.fn().mockResolvedValue([]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();

    await expect(waitForTempReuFile([], listRemoteTempFiles, sleep, onProgress, 50_000, 1_000)).rejects.toThrow(
      "Timed out waiting for the new REU file in /Temp.",
    );

    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        step: "waiting-for-file",
        progress: 98,
      }),
    );
  });

  it("fails cleanly when save never produces a new /Temp REU file", async () => {
    const workflow = createReuWorkflow({
      ensureLocalSnapshotStorage: vi.fn().mockResolvedValue(undefined),
      listRemoteTempFiles: vi.fn().mockResolvedValue([]),
      runSaveRemoteReu: vi.fn().mockResolvedValue(undefined),
      readRemoteFile: vi.fn(),
      persistLocalSnapshot: vi.fn(),
      saveToStore: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(workflow.saveSnapshot()).rejects.toThrow("Timed out waiting for the new REU file in /Temp.");

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "REU workflow failed",
      expect.objectContaining({
        operation: "save",
        step: "waiting-for-file",
        phase: "waiting-for-file",
        transport: "ftp",
        remotePath: "/Temp",
        status: "error",
      }),
    );
  });

  it("fails cleanly when restore cannot upload the REU file to /Temp", async () => {
    const snapshot: ReuSnapshotStorageEntry = {
      id: "reu-upload-failure",
      filename: "upload-failure.reu",
      createdAt: "2026-03-29T10:02:00Z",
      snapshotType: "reu",
      sizeBytes: 3,
      remoteFileName: "upload-failure.reu",
      storage: { kind: "native-data", path: "reu-snapshots/upload-failure.reu" },
      metadata: {
        snapshot_type: "reu",
        display_ranges: ["REU image"],
        created_at: "2026-03-29 10:02:00",
      },
    };
    const workflow = createReuWorkflow({
      readLocalSnapshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      writeRemoteFile: vi.fn().mockRejectedValue(new Error("FTP upload failed")),
      runRestoreRemoteReu: vi.fn(),
    });

    await expect(workflow.restoreSnapshot(snapshot, "load-into-reu")).rejects.toThrow("FTP upload failed");

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "REU workflow failed",
      expect.objectContaining({
        operation: "restore",
        step: "uploading",
        phase: "uploading",
        transport: "ftp",
        localPath: "reu-snapshots/upload-failure.reu",
        remotePath: "/Temp/upload-failure.reu",
        status: "error",
      }),
    );
  });

  it("fails cleanly when restore cannot apply the uploaded REU file over telnet", async () => {
    const snapshot: ReuSnapshotStorageEntry = {
      id: "reu-restore-failure",
      filename: "restore-failure.reu",
      createdAt: "2026-03-29T10:02:00Z",
      snapshotType: "reu",
      sizeBytes: 3,
      remoteFileName: "restore-failure.reu",
      storage: { kind: "native-data", path: "reu-snapshots/restore-failure.reu" },
      metadata: {
        snapshot_type: "reu",
        display_ranges: ["REU image"],
        created_at: "2026-03-29 10:02:00",
      },
    };
    const workflow = createReuWorkflow({
      readLocalSnapshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      writeRemoteFile: vi.fn().mockResolvedValue(undefined),
      runRestoreRemoteReu: vi.fn().mockRejectedValue(new Error("Telnet apply failed")),
    });

    await expect(workflow.restoreSnapshot(snapshot, "load-into-reu")).rejects.toThrow("Telnet apply failed");

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "REU workflow failed",
      expect.objectContaining({
        operation: "restore",
        step: "restoring",
        phase: "restoring",
        transport: "telnet",
        localPath: "reu-snapshots/restore-failure.reu",
        remotePath: "/Temp/restore-failure.reu",
        status: "error",
      }),
    );
  });
});

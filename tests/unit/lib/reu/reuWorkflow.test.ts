import { describe, expect, it, vi } from "vitest";
import { createReuWorkflow, detectUpdatedTempReuFile, waitForTempReuFile } from "@/lib/reu/reuWorkflow";
import type { ReuSnapshotStorageEntry } from "@/lib/reu/reuSnapshotTypes";

describe("reuWorkflow", () => {
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

  it("saves REU snapshots into the dedicated REU store flow", async () => {
    const saveToStore = vi.fn();
    const persistLocalSnapshot = vi.fn().mockResolvedValue({ kind: "native-data", path: "reu-snapshots/test.reu" });
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

    const entry = await workflow.saveSnapshot();

    expect(entry.snapshotType).toBe("reu");
    expect(entry.remoteFileName).toBe("capture.reu");
    expect(saveToStore).toHaveBeenCalledWith(expect.objectContaining({ snapshotType: "reu" }));
    expect(persistLocalSnapshot).toHaveBeenCalled();
  });

  it("uploads a local REU snapshot back to /Temp before restore", async () => {
    const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
    const runRestoreRemoteReu = vi.fn().mockResolvedValue(undefined);
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

    await workflow.restoreSnapshot(snapshot, "preload-on-startup");

    expect(writeRemoteFile).toHaveBeenCalledWith("/Temp/capture.reu", new Uint8Array([1, 2, 3]));
    expect(runRestoreRemoteReu).toHaveBeenCalledWith("capture.reu", "preload-on-startup");
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
});

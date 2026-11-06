import { beforeEach, describe, expect, it, vi } from "vitest";
import * as logging from "@/lib/logging";
import { createConfigWorkflow, detectUpdatedTempConfigFile, waitForTempConfigFile } from "@/lib/config/configWorkflow";
import type { ConfigSnapshotFileLocation } from "@/lib/config/configSnapshotTypes";
import { DISK_WORK_CLIENT_ID_STORAGE_KEY } from "@/lib/disks/diskWorkClientId";

const addLogSpy = vi.spyOn(logging, "addLog").mockImplementation(() => undefined);
const addErrorLogSpy = vi.spyOn(logging, "addErrorLog").mockImplementation(() => undefined);

const setInstallId = (clientId: string) => localStorage.setItem(DISK_WORK_CLIENT_ID_STORAGE_KEY, clientId);

describe("configWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInstallId("0a1b2c3d");
  });

  it("detects the newest changed .cfg file in /Temp", () => {
    const file = detectUpdatedTempConfigFile(
      [{ name: "old.cfg", path: "/Temp/old.cfg", modifiedAt: "2026-03-29T10:00:00Z", size: 10 }],
      [
        { name: "old.cfg", path: "/Temp/old.cfg", modifiedAt: "2026-03-29T10:00:00Z", size: 10 },
        { name: "newer.cfg", path: "/Temp/newer.cfg", modifiedAt: "2026-03-29T10:01:00Z", size: 20 },
      ],
    );

    expect(file?.name).toBe("newer.cfg");
  });

  it("ignores unchanged files and non-cfg updates when detecting new temp files", () => {
    const file = detectUpdatedTempConfigFile(
      [{ name: "old.cfg", path: "/Temp/old.cfg", modifiedAt: "2026-03-29T10:00:00Z", size: 10 }],
      [
        { name: "old.cfg", path: "/Temp/old.cfg", modifiedAt: "2026-03-29T10:00:00Z", size: 10 },
        { name: "notes.txt", path: "/Temp/notes.txt", modifiedAt: "2026-03-29T10:01:00Z", size: 20 },
      ],
    );

    expect(file).toBeNull();
  });

  it("waits for a new config file to appear and become stable across two consecutive polls", async () => {
    const listRemoteTempFiles = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "next.cfg", path: "/Temp/next.cfg", modifiedAt: "2026-03-29T10:01:00Z", size: 5 },
      ])
      .mockResolvedValueOnce([
        { name: "next.cfg", path: "/Temp/next.cfg", modifiedAt: "2026-03-29T10:01:00Z", size: 5 },
      ]);

    const file = await waitForTempConfigFile([], listRemoteTempFiles, vi.fn().mockResolvedValue(undefined));

    expect(file.name).toBe("next.cfg");
    expect(listRemoteTempFiles).toHaveBeenCalledTimes(2);
  });

  it("HARD18-024: keeps polling while the config file is still being written, resolving only once size is stable", async () => {
    const listRemoteTempFiles = vi
      .fn()
      .mockResolvedValueOnce([
        { name: "growing.cfg", path: "/Temp/growing.cfg", modifiedAt: "2026-03-29T10:01:00Z", size: 10 },
      ])
      .mockResolvedValueOnce([
        { name: "growing.cfg", path: "/Temp/growing.cfg", modifiedAt: "2026-03-29T10:01:05Z", size: 40 },
      ])
      .mockResolvedValueOnce([
        { name: "growing.cfg", path: "/Temp/growing.cfg", modifiedAt: "2026-03-29T10:01:05Z", size: 40 },
      ]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const file = await waitForTempConfigFile([], listRemoteTempFiles, sleep);

    expect(file.size).toBe(40);
    expect(listRemoteTempFiles).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("times out when no new config file appears and reports waiting progress", async () => {
    const listRemoteTempFiles = vi.fn().mockResolvedValue([]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();

    await expect(waitForTempConfigFile([], listRemoteTempFiles, sleep, onProgress, 2_000, 1_000)).rejects.toThrow(
      "Timed out waiting for the new config file in /Temp.",
    );

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "waiting-for-file",
        progress: 0,
      }),
    );
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("emits the authoritative save step order and stores the config snapshot", async () => {
    const persistLocalSnapshot = vi.fn().mockResolvedValue({ kind: "native-data", path: "config-snapshots/test.cfg" });
    const onProgress = vi.fn();
    const workflow = createConfigWorkflow({
      ensureLocalSnapshotStorage: vi.fn().mockResolvedValue(undefined),
      listRemoteTempFiles: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: "capture.cfg", path: "/Temp/capture.cfg", modifiedAt: "2026-03-29T10:01:00Z" }])
        .mockResolvedValueOnce([
          { name: "capture.cfg", path: "/Temp/capture.cfg", modifiedAt: "2026-03-29T10:01:00Z" },
        ]),
      runSaveRemoteConfig: vi.fn().mockResolvedValue(undefined),
      readRemoteFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      persistLocalSnapshot,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-03-29T10:02:00Z"),
    });

    const entry = await workflow.saveSnapshot(onProgress);

    expect(entry.remoteFileName).toBe("capture.cfg");
    expect(entry.fileName).toMatch(/^c64u-config-/);
    expect(persistLocalSnapshot).toHaveBeenCalled();
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual([
      "preparing",
      "scanning-temp",
      "saving-config",
      "waiting-for-file",
      "waiting-for-file",
      "downloading",
      "persisting",
      "complete",
    ]);
    expect(addLogSpy).toHaveBeenCalledWith(
      "info",
      "Config workflow complete",
      expect.objectContaining({
        operation: "save",
        status: "success",
        remoteFileName: "capture.cfg",
        remotePath: "/Temp/capture.cfg",
      }),
    );
  });

  it("does not take a config file another install staged in /Temp for this install's save", () => {
    const file = detectUpdatedTempConfigFile(
      [],
      [
        { name: "saved.cfg", path: "/Temp/saved.cfg", modifiedAt: "2026-03-29T10:01:00Z", size: 64 },
        {
          name: "c64commander-cfg-9f8e7d6c.cfg",
          path: "/Temp/c64commander-cfg-9f8e7d6c.cfg",
          modifiedAt: "2026-03-29T10:02:00Z",
          size: 64,
        },
      ],
    );

    expect(file?.name).toBe("saved.cfg");
  });

  it("uploads a local config snapshot to /Temp before applying it", async () => {
    const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
    const runApplyRemoteConfig = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const workflow = createConfigWorkflow({
      writeRemoteFile,
      runApplyRemoteConfig,
    });

    await workflow.applyLocalSnapshot("Saved Setup.cfg", new Uint8Array([1, 2, 3]), onProgress);

    expect(writeRemoteFile).toHaveBeenCalledWith("/Temp/c64commander-cfg-0a1b2c3d.cfg", new Uint8Array([1, 2, 3]));
    expect(runApplyRemoteConfig).toHaveBeenCalledWith("c64commander-cfg-0a1b2c3d.cfg");
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual([
      "reading-local",
      "uploading",
      "restoring",
      "complete",
    ]);
  });

  /*
   * Applying a settings file means walking the device's own file browser to it over Telnet, one
   * keypress and one screen read at a time. On hardware that walk did not finish inside seven
   * minutes for a file two directories deep on a USB stick holding thirty-one entries. Copying the
   * file to /Temp first makes the walk a handful of keypresses whatever the user's folders hold.
   */
  it("copies a config that is on the Ultimate to /Temp and applies it from there", async () => {
    const readRemoteFile = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));
    const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
    const runApplyRemoteConfig = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const workflow = createConfigWorkflow({
      readRemoteFile,
      writeRemoteFile,
      runApplyRemoteConfig,
    });

    await workflow.applyRemoteSnapshot("/USB1/test-data/snapshots/config.cfg", onProgress);

    expect(readRemoteFile).toHaveBeenCalledWith("/USB1/test-data/snapshots/config.cfg");
    expect(writeRemoteFile).toHaveBeenCalledWith("/Temp/c64commander-cfg-0a1b2c3d.cfg", new Uint8Array([4, 5, 6]));
    expect(runApplyRemoteConfig).toHaveBeenCalledWith("c64commander-cfg-0a1b2c3d.cfg");
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual(["uploading", "restoring", "complete"]);
  });

  it("applies a config that is already in /Temp where it lies", async () => {
    const readRemoteFile = vi.fn();
    const writeRemoteFile = vi.fn();
    const runApplyRemoteConfig = vi.fn().mockResolvedValue(undefined);
    const workflow = createConfigWorkflow({ readRemoteFile, writeRemoteFile, runApplyRemoteConfig });

    await workflow.applyRemoteSnapshot("/Temp/config.cfg");

    expect(readRemoteFile).not.toHaveBeenCalled();
    expect(writeRemoteFile).not.toHaveBeenCalled();
    expect(runApplyRemoteConfig).toHaveBeenCalledWith("config.cfg");
  });

  it("fails cleanly when save never produces a new /Temp config file", async () => {
    const workflow = createConfigWorkflow({
      ensureLocalSnapshotStorage: vi.fn().mockResolvedValue(undefined),
      listRemoteTempFiles: vi.fn().mockResolvedValue([]),
      runSaveRemoteConfig: vi.fn().mockResolvedValue(undefined),
      readRemoteFile: vi.fn(),
      persistLocalSnapshot: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(workflow.saveSnapshot()).rejects.toThrow("Timed out waiting for the new config file in /Temp.");

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "Config workflow failed",
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

  it("logs a Stop-canceled remote apply as canceled, not as a failed workflow", async () => {
    const { ConfigApplyCancelledError } = await import("@/lib/config/configApplyCancellation");
    const runApplyRemoteConfig = vi.fn().mockRejectedValue(new ConfigApplyCancelledError("screen read"));
    const workflow = createConfigWorkflow({ readRemoteFile: vi.fn(), writeRemoteFile: vi.fn(), runApplyRemoteConfig });

    await expect(workflow.applyRemoteSnapshot("/Temp/config.cfg")).rejects.toBeInstanceOf(ConfigApplyCancelledError);

    expect(addErrorLogSpy).not.toHaveBeenCalledWith("Config workflow failed", expect.anything());
  });

  it("selects the more recently modified file when multiple changed cfg files appear in /Temp", () => {
    // Exercises the sort comparator (lines 155-158) whose body only runs with multiple candidates
    const file = detectUpdatedTempConfigFile(
      [],
      [
        { name: "older.cfg", path: "/Temp/older.cfg", modifiedAt: "2026-03-29T09:00:00Z", size: 10 },
        { name: "newer.cfg", path: "/Temp/newer.cfg", modifiedAt: "2026-03-29T10:00:00Z", size: 10 },
      ],
    );
    expect(file?.name).toBe("newer.cfg");
  });

  it("fails cleanly when applyLocalSnapshot throws during upload", async () => {
    const workflow = createConfigWorkflow({
      writeRemoteFile: vi.fn().mockRejectedValue(new Error("upload error")),
    });

    await expect(workflow.applyLocalSnapshot("config.cfg", new Uint8Array([1, 2, 3]))).rejects.toThrow("upload error");

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "Config workflow failed",
      expect.objectContaining({ operation: "apply-local", status: "error" }),
    );
  });

  it("fails cleanly when applyRemoteSnapshot throws during apply", async () => {
    const workflow = createConfigWorkflow({
      readRemoteFile: vi.fn().mockResolvedValue(new Uint8Array([1])),
      writeRemoteFile: vi.fn().mockResolvedValue(undefined),
      runApplyRemoteConfig: vi.fn().mockRejectedValue(new Error("apply error")),
    });

    await expect(workflow.applyRemoteSnapshot("/USB1/snapshots/config.cfg")).rejects.toThrow("apply error");

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "Config workflow failed",
      expect.objectContaining({ operation: "apply-remote", status: "error" }),
    );
  });

  it("uses android-tree displayPath when persistLocalSnapshot returns one", async () => {
    const androidStorage: ConfigSnapshotFileLocation = {
      kind: "android-tree",
      treeUri: "content://com.example/tree/docs",
      path: "raw/c64u-config-2026-01-01T00-00-00Z.cfg",
      displayPath: "Documents/c64u-config-2026-01-01T00-00-00Z.cfg",
    };
    const persistLocalSnapshot = vi.fn().mockResolvedValue(androidStorage);
    const workflow = createConfigWorkflow({
      ensureLocalSnapshotStorage: vi.fn().mockResolvedValue(undefined),
      listRemoteTempFiles: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: "capture.cfg", path: "/Temp/capture.cfg", modifiedAt: "2026-01-01T00:00:00Z" }])
        .mockResolvedValueOnce([
          { name: "capture.cfg", path: "/Temp/capture.cfg", modifiedAt: "2026-01-01T00:00:00Z" },
        ]),
      runSaveRemoteConfig: vi.fn().mockResolvedValue(undefined),
      readRemoteFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      persistLocalSnapshot,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const entry = await workflow.saveSnapshot();

    expect(entry.storage).toEqual(androidStorage);
    expect(addLogSpy).toHaveBeenCalledWith(
      "info",
      "Config workflow complete",
      expect.objectContaining({ localPath: "Documents/c64u-config-2026-01-01T00-00-00Z.cfg" }),
    );
  });

  it("uses android-tree path when displayPath is null", async () => {
    const androidStorage: ConfigSnapshotFileLocation = {
      kind: "android-tree",
      treeUri: "content://com.example/tree/docs",
      path: "raw/snapshot.cfg",
      displayPath: null,
    };
    const persistLocalSnapshot = vi.fn().mockResolvedValue(androidStorage);
    const workflow = createConfigWorkflow({
      ensureLocalSnapshotStorage: vi.fn().mockResolvedValue(undefined),
      listRemoteTempFiles: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: "snap.cfg", path: "/Temp/snap.cfg", modifiedAt: "2026-01-01T00:00:00Z" }])
        .mockResolvedValueOnce([{ name: "snap.cfg", path: "/Temp/snap.cfg", modifiedAt: "2026-01-01T00:00:00Z" }]),
      runSaveRemoteConfig: vi.fn().mockResolvedValue(undefined),
      readRemoteFile: vi.fn().mockResolvedValue(new Uint8Array([1])),
      persistLocalSnapshot,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const entry = await workflow.saveSnapshot();

    expect(entry.storage).toEqual(androidStorage);
    expect(addLogSpy).toHaveBeenCalledWith(
      "info",
      "Config workflow complete",
      expect.objectContaining({ localPath: "raw/snapshot.cfg" }),
    );
  });

  it("stages the same config file under a different /Temp name on each install", async () => {
    const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
    const runApplyRemoteConfig = vi.fn().mockResolvedValue(undefined);
    const workflow = createConfigWorkflow({ writeRemoteFile, runApplyRemoteConfig });

    setInstallId("11111111");
    await workflow.applyLocalSnapshot("Shared Setup.cfg", new Uint8Array([1]));
    setInstallId("22222222");
    await workflow.applyLocalSnapshot("Shared Setup.cfg", new Uint8Array([2]));
    await workflow.applyRemoteSnapshot("/USB1/Shared Setup.cfg");

    expect(writeRemoteFile.mock.calls.map(([path]) => path)).toEqual([
      "/Temp/c64commander-cfg-11111111.cfg",
      "/Temp/c64commander-cfg-22222222.cfg",
      "/Temp/c64commander-cfg-22222222.cfg",
    ]);
    expect(runApplyRemoteConfig.mock.calls.map(([name]) => name)).toEqual([
      "c64commander-cfg-11111111.cfg",
      "c64commander-cfg-22222222.cfg",
      "c64commander-cfg-22222222.cfg",
    ]);
  });

  it("handles null modifiedAt on both entries when sorting multiple changed cfg files", () => {
    const file = detectUpdatedTempConfigFile(
      [],
      [
        { name: "a.cfg", path: "/Temp/a.cfg" },
        { name: "b.cfg", path: "/Temp/b.cfg" },
      ],
    );
    expect(file).not.toBeNull();
  });

  it("handles null size in before-map construction", () => {
    const file = detectUpdatedTempConfigFile(
      [{ name: "a.cfg", path: "/Temp/a.cfg" }],
      [
        { name: "a.cfg", path: "/Temp/a.cfg" },
        { name: "b.cfg", path: "/Temp/b.cfg" },
      ],
    );
    expect(file?.name).toBe("b.cfg");
  });
});

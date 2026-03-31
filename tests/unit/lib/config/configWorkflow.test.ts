import { beforeEach, describe, expect, it, vi } from "vitest";
import * as logging from "@/lib/logging";
import { createConfigWorkflow, detectUpdatedTempConfigFile, waitForTempConfigFile } from "@/lib/config/configWorkflow";

const addLogSpy = vi.spyOn(logging, "addLog").mockImplementation(() => undefined);
const addErrorLogSpy = vi.spyOn(logging, "addErrorLog").mockImplementation(() => undefined);

describe("configWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("waits for a new config file to appear", async () => {
    const listRemoteTempFiles = vi
      .fn()
      .mockResolvedValueOnce([{ name: "config.cfg", path: "/Temp/config.cfg", modifiedAt: "2026-03-29T10:00:00Z" }])
      .mockResolvedValueOnce([{ name: "next.cfg", path: "/Temp/next.cfg", modifiedAt: "2026-03-29T10:01:00Z" }]);

    const file = await waitForTempConfigFile([], listRemoteTempFiles, vi.fn().mockResolvedValue(undefined));

    expect(file.name).toBe("config.cfg");
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

  it("uploads a local config snapshot to /Temp before applying it", async () => {
    const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
    const runApplyRemoteConfig = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const workflow = createConfigWorkflow({
      writeRemoteFile,
      runApplyRemoteConfig,
    });

    await workflow.applyLocalSnapshot("Saved Setup.cfg", new Uint8Array([1, 2, 3]), onProgress);

    expect(writeRemoteFile).toHaveBeenCalledWith("/Temp/Saved-Setup.cfg", new Uint8Array([1, 2, 3]));
    expect(runApplyRemoteConfig).toHaveBeenCalledWith("Saved-Setup.cfg");
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual([
      "reading-local",
      "uploading",
      "restoring",
      "complete",
    ]);
  });

  it("applies a remote config without uploading when the file is already on the Ultimate", async () => {
    const runApplyRemoteConfigByPath = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const workflow = createConfigWorkflow({
      runApplyRemoteConfigByPath,
    });

    await workflow.applyRemoteSnapshot("/USB1/test-data/snapshots/config.cfg", onProgress);

    expect(runApplyRemoteConfigByPath).toHaveBeenCalledWith("/USB1/test-data/snapshots/config.cfg");
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual(["restoring", "complete"]);
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

    await expect(workflow.applyLocalSnapshot("config.cfg", new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "upload error",
    );

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "Config workflow failed",
      expect.objectContaining({ operation: "apply-local", status: "error" }),
    );
  });

  it("fails cleanly when applyRemoteSnapshot throws during apply", async () => {
    const workflow = createConfigWorkflow({
      runApplyRemoteConfigByPath: vi.fn().mockRejectedValue(new Error("apply error")),
    });

    await expect(workflow.applyRemoteSnapshot("/USB1/snapshots/config.cfg")).rejects.toThrow("apply error");

    expect(addErrorLogSpy).toHaveBeenCalledWith(
      "Config workflow failed",
      expect.objectContaining({ operation: "apply-remote", status: "error" }),
    );
  });
});

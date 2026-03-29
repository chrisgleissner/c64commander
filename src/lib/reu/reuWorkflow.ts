/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getBuildInfo } from "@/lib/buildInfo";
import { addErrorLog, addLog, buildErrorLogDetails } from "@/lib/logging";
import { formatDisplayTimestamp, formatFileTimestamp } from "@/lib/snapshot/snapshotFilename";
import { persistReuSnapshotFile, readReuSnapshotBytes } from "./reuSnapshotStorage";
import { saveReuSnapshotToStore } from "./reuSnapshotStore";
import type { ReuProgressState, ReuRestoreMode, ReuSnapshotStorageEntry } from "./reuSnapshotTypes";

export type ReuRemoteFile = {
  name: string;
  path: string;
  size?: number;
  modifiedAt?: string | null;
};

type ReuWorkflowDependencies = {
  ensureLocalSnapshotStorage: () => Promise<void>;
  listRemoteTempFiles: () => Promise<ReuRemoteFile[]>;
  readRemoteFile: (path: string) => Promise<Uint8Array>;
  writeRemoteFile: (path: string, bytes: Uint8Array) => Promise<void>;
  runSaveRemoteReu: () => Promise<void>;
  runRestoreRemoteReu: (fileName: string, mode: ReuRestoreMode) => Promise<void>;
  readLocalSnapshot: (entry: ReuSnapshotStorageEntry) => Promise<Uint8Array>;
  persistLocalSnapshot: (fileName: string, bytes: Uint8Array) => Promise<ReuSnapshotStorageEntry["storage"]>;
  saveToStore: (entry: ReuSnapshotStorageEntry) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_INTERVAL_MS = 1_000;
const REU_DISPLAY_RANGES = ["REU image"];

type ReuWorkflowOperation = "save" | "restore";
type ReuWorkflowTransport = "local" | "ftp" | "telnet";
type ReuWorkflowLogContext = {
  localFileName?: string;
  localPath?: string;
  remoteFileName?: string;
  remotePath?: string;
};

const generateId = () =>
  `reu-${Date.now()}-${Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0")}`;

const defaultDependencies: ReuWorkflowDependencies = {
  ensureLocalSnapshotStorage: async () => undefined,
  listRemoteTempFiles: async () => [],
  readRemoteFile: async () => new Uint8Array(),
  writeRemoteFile: async () => undefined,
  runSaveRemoteReu: async () => undefined,
  runRestoreRemoteReu: async () => undefined,
  readLocalSnapshot: readReuSnapshotBytes,
  persistLocalSnapshot: persistReuSnapshotFile,
  saveToStore: saveReuSnapshotToStore,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
};

const describeStoragePath = (storage: ReuSnapshotStorageEntry["storage"]) =>
  "displayPath" in storage ? (storage.displayPath ?? storage.path) : storage.path;

const getTransportForStep = (operation: ReuWorkflowOperation, step: ReuProgressState["step"]): ReuWorkflowTransport => {
  switch (step) {
    case "preparing":
    case "persisting":
    case "reading-local":
      return "local";
    case "scanning-temp":
    case "waiting-for-file":
    case "downloading":
    case "uploading":
      return "ftp";
    case "saving-reu":
    case "restoring":
      return "telnet";
    case "complete":
      return operation === "save" ? "local" : "telnet";
  }
};

const createProgressReporter = (operation: ReuWorkflowOperation, onProgress?: (state: ReuProgressState) => void) => {
  const startedAt = Date.now();
  const initialStep: ReuProgressState["step"] = operation === "save" ? "preparing" : "reading-local";
  let currentStep: ReuProgressState["step"] | null = null;
  let latestContext: ReuWorkflowLogContext = {};

  const emit = (state: ReuProgressState, context: ReuWorkflowLogContext = {}) => {
    latestContext = { ...latestContext, ...context };
    if (state.step !== currentStep) {
      addLog("info", "REU workflow step", {
        operation,
        step: state.step,
        phase: state.step,
        transport: getTransportForStep(operation, state.step),
        status: "running",
        durationMs: Date.now() - startedAt,
        progress: state.progress ?? null,
        ...latestContext,
      });
      currentStep = state.step;
    }
    onProgress?.(state);
  };

  const succeed = (step: ReuProgressState["step"], context: ReuWorkflowLogContext = {}) => {
    latestContext = { ...latestContext, ...context };
    addLog("info", "REU workflow complete", {
      operation,
      step,
      phase: step,
      transport: getTransportForStep(operation, step),
      status: "success",
      durationMs: Date.now() - startedAt,
      ...latestContext,
    });
  };

  const fail = (error: unknown, context: ReuWorkflowLogContext = {}) => {
    latestContext = { ...latestContext, ...context };
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    const step = currentStep ?? initialStep;
    addErrorLog(
      "REU workflow failed",
      buildErrorLogDetails(resolvedError, {
        operation,
        step,
        phase: step,
        transport: getTransportForStep(operation, step),
        status: "error",
        durationMs: Date.now() - startedAt,
        ...latestContext,
        error: resolvedError.message,
      }),
    );
  };

  return { emit, succeed, fail };
};

const emitProgress = (onProgress: ((state: ReuProgressState) => void) | undefined, state: ReuProgressState) => {
  onProgress?.(state);
};

export const detectUpdatedTempReuFile = (before: ReuRemoteFile[], after: ReuRemoteFile[]): ReuRemoteFile | null => {
  const beforeMap = new Map(before.map((entry) => [entry.name, `${entry.size ?? -1}:${entry.modifiedAt ?? ""}`]));
  const changed = after
    .filter((entry) => entry.name.toLowerCase().endsWith(".reu"))
    .filter((entry) => beforeMap.get(entry.name) !== `${entry.size ?? -1}:${entry.modifiedAt ?? ""}`)
    .sort((left, right) => {
      const leftTime = left.modifiedAt ? Date.parse(left.modifiedAt) : 0;
      const rightTime = right.modifiedAt ? Date.parse(right.modifiedAt) : 0;
      return rightTime - leftTime;
    });
  return changed[0] ?? null;
};

export const waitForTempReuFile = async (
  before: ReuRemoteFile[],
  listRemoteTempFiles: () => Promise<ReuRemoteFile[]>,
  sleep: (ms: number) => Promise<void>,
  onProgress?: (state: ReuProgressState) => void,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  intervalMs = DEFAULT_WAIT_INTERVAL_MS,
) => {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    emitProgress(onProgress, {
      step: "waiting-for-file",
      title: "Waiting for REU file",
      description: "The Ultimate can take around 30 seconds to finish saving the REU image.",
      progress: Math.min(99, Math.round((attempt / attempts) * 100)),
    });
    const after = await listRemoteTempFiles();
    const file = detectUpdatedTempReuFile(before, after);
    if (file) return file;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for the new REU file in /Temp.");
};

export const createReuWorkflow = (overrides: Partial<ReuWorkflowDependencies> = {}) => {
  const deps = { ...defaultDependencies, ...overrides };

  const saveSnapshot = async (onProgress?: (state: ReuProgressState) => void) => {
    const reporter = createProgressReporter("save", onProgress);
    let logContext: ReuWorkflowLogContext = {};
    const emit = (state: ReuProgressState, context: ReuWorkflowLogContext = {}) => {
      logContext = { ...logContext, ...context };
      reporter.emit(state, logContext);
    };

    try {
      emit(
        {
          step: "preparing",
          title: "Preparing REU save",
          description: "Checking local REU snapshot storage.",
          progress: 5,
        },
        { remotePath: "/Temp" },
      );
      await deps.ensureLocalSnapshotStorage();

      emit(
        {
          step: "scanning-temp",
          title: "Scanning /Temp",
          description: "Capturing the current list of REU files before saving.",
          progress: 10,
        },
        { remotePath: "/Temp" },
      );
      const before = await deps.listRemoteTempFiles();

      emit(
        {
          step: "saving-reu",
          title: "Saving REU on the Ultimate",
          description: "The menu action is running in /Temp.",
          progress: 20,
        },
        { remotePath: "/Temp" },
      );
      await deps.runSaveRemoteReu();

      const remoteFile = await waitForTempReuFile(before, deps.listRemoteTempFiles, deps.sleep, (state) =>
        emit(state, { remotePath: "/Temp" }),
      );

      emit(
        {
          step: "downloading",
          title: "Downloading REU snapshot",
          description: `Downloading ${remoteFile.name} from /Temp.`,
          progress: 80,
        },
        { remoteFileName: remoteFile.name, remotePath: remoteFile.path },
      );
      const bytes = await deps.readRemoteFile(remoteFile.path);

      const now = deps.now();
      const localFileName = `c64-reu-${formatFileTimestamp(now)}-${remoteFile.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
      emit(
        {
          step: "persisting",
          title: "Saving local REU snapshot",
          description: "Writing the REU image into local native storage.",
          progress: 90,
        },
        { localFileName, localPath: localFileName, remoteFileName: remoteFile.name, remotePath: remoteFile.path },
      );
      const storage = await deps.persistLocalSnapshot(localFileName, bytes);
      const resolvedLocalPath = describeStoragePath(storage);
      const entry: ReuSnapshotStorageEntry = {
        id: generateId(),
        filename: localFileName,
        createdAt: now.toISOString(),
        snapshotType: "reu",
        sizeBytes: bytes.byteLength,
        remoteFileName: remoteFile.name,
        storage,
        metadata: {
          snapshot_type: "reu",
          display_ranges: REU_DISPLAY_RANGES,
          created_at: formatDisplayTimestamp(now),
          content_name: remoteFile.name,
          app_version: getBuildInfo().versionLabel,
        },
      };
      deps.saveToStore(entry);
      emit(
        {
          step: "complete",
          title: "REU snapshot saved",
          description: remoteFile.name,
          progress: 100,
        },
        {
          localFileName,
          localPath: resolvedLocalPath,
          remoteFileName: remoteFile.name,
          remotePath: remoteFile.path,
        },
      );
      reporter.succeed("complete", {
        localFileName,
        localPath: resolvedLocalPath,
        remoteFileName: remoteFile.name,
        remotePath: remoteFile.path,
      });
      return entry;
    } catch (error) {
      reporter.fail(error, logContext);
      throw error;
    }
  };

  const restoreSnapshot = async (
    snapshot: ReuSnapshotStorageEntry,
    mode: ReuRestoreMode,
    onProgress?: (state: ReuProgressState) => void,
  ) => {
    const reporter = createProgressReporter("restore", onProgress);
    const localFileName = snapshot.filename;
    const localPath = describeStoragePath(snapshot.storage);
    const remoteFileName = snapshot.remoteFileName || snapshot.filename;
    const remotePath = `/Temp/${remoteFileName}`;
    let logContext: ReuWorkflowLogContext = { localFileName, localPath, remoteFileName, remotePath };
    const emit = (state: ReuProgressState, context: ReuWorkflowLogContext = {}) => {
      logContext = { ...logContext, ...context };
      reporter.emit(state, logContext);
    };

    try {
      emit(
        {
          step: "reading-local",
          title: "Reading REU snapshot",
          description: "Loading the local REU image before upload.",
          progress: 10,
        },
        { localFileName, localPath },
      );
      const bytes = await deps.readLocalSnapshot(snapshot);
      emit(
        {
          step: "uploading",
          title: "Uploading REU snapshot",
          description: `Uploading ${remoteFileName} to /Temp.`,
          progress: 50,
        },
        { localFileName, localPath, remoteFileName, remotePath },
      );
      await deps.writeRemoteFile(remotePath, bytes);

      emit(
        {
          step: "restoring",
          title: mode === "load-into-reu" ? "Loading REU image" : "Configuring REU preload",
          description: "Selecting the uploaded file over Telnet.",
          progress: 90,
        },
        { localFileName, localPath, remoteFileName, remotePath },
      );
      await deps.runRestoreRemoteReu(remoteFileName, mode);
      emit(
        {
          step: "complete",
          title: mode === "load-into-reu" ? "REU image loaded" : "REU preload configured",
          description: remoteFileName,
          progress: 100,
        },
        { localFileName, localPath, remoteFileName, remotePath },
      );
      reporter.succeed("complete", { localFileName, localPath, remoteFileName, remotePath });
    } catch (error) {
      reporter.fail(error, logContext);
      throw error;
    }
  };

  return { saveSnapshot, restoreSnapshot };
};

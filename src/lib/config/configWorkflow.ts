/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { formatFileTimestamp } from "@/lib/snapshot/snapshotFilename";
import type { ConfigProgressState, ConfigSnapshotFileLocation, SavedConfigSnapshot } from "./configSnapshotTypes";

export type ConfigRemoteFile = {
  name: string;
  path: string;
  size?: number;
  modifiedAt?: string | null;
};

type ConfigWorkflowDependencies = {
  ensureLocalSnapshotStorage: () => Promise<void>;
  listRemoteTempFiles: () => Promise<ConfigRemoteFile[]>;
  readRemoteFile: (path: string) => Promise<Uint8Array>;
  writeRemoteFile: (path: string, bytes: Uint8Array) => Promise<void>;
  persistLocalSnapshot: (fileName: string, bytes: Uint8Array) => Promise<ConfigSnapshotFileLocation>;
  runSaveRemoteConfig: () => Promise<void>;
  runApplyRemoteConfig: (fileName: string) => Promise<void>;
  runApplyRemoteConfigByPath: (path: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_INTERVAL_MS = 1_000;

type ConfigWorkflowOperation = "save" | "apply-local" | "apply-remote";
type ConfigWorkflowTransport = "local" | "ftp" | "telnet";
type ConfigWorkflowLogContext = {
  localFileName?: string;
  localPath?: string;
  remoteFileName?: string;
  remotePath?: string;
};

const defaultDependencies: ConfigWorkflowDependencies = {
  ensureLocalSnapshotStorage: async () => undefined,
  listRemoteTempFiles: async () => [],
  readRemoteFile: async () => new Uint8Array(),
  writeRemoteFile: async () => undefined,
  persistLocalSnapshot: async (fileName) => ({ kind: "native-data", path: fileName }),
  runSaveRemoteConfig: async () => undefined,
  runApplyRemoteConfig: async () => undefined,
  runApplyRemoteConfigByPath: async () => undefined,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
};

const describeStoragePath = (storage: ConfigSnapshotFileLocation) =>
  "displayPath" in storage ? (storage.displayPath ?? storage.path) : storage.path;

const getTransportForStep = (
  operation: ConfigWorkflowOperation,
  step: ConfigProgressState["step"],
): ConfigWorkflowTransport => {
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
    case "saving-config":
    case "restoring":
      return "telnet";
    case "complete":
      return operation === "save" ? "local" : "telnet";
  }
};

const normalizeConfigFileName = (fileName: string) => {
  const baseName = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "config.cfg";
  return baseName.toLowerCase().endsWith(".cfg") ? baseName : `${baseName}.cfg`;
};

const createProgressReporter = (
  operation: ConfigWorkflowOperation,
  onProgress?: (state: ConfigProgressState) => void,
) => {
  const startedAt = Date.now();
  const initialStep: ConfigProgressState["step"] = operation === "save" ? "preparing" : "reading-local";
  let currentStep: ConfigProgressState["step"] | null = null;
  let latestContext: ConfigWorkflowLogContext = {};

  const emit = (state: ConfigProgressState, context: ConfigWorkflowLogContext = {}) => {
    latestContext = { ...latestContext, ...context };
    if (state.step !== currentStep) {
      addLog("info", "Config workflow step", {
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

  const succeed = (step: ConfigProgressState["step"], context: ConfigWorkflowLogContext = {}) => {
    latestContext = { ...latestContext, ...context };
    addLog("info", "Config workflow complete", {
      operation,
      step,
      phase: step,
      transport: getTransportForStep(operation, step),
      status: "success",
      durationMs: Date.now() - startedAt,
      ...latestContext,
    });
  };

  const fail = (error: unknown, context: ConfigWorkflowLogContext = {}) => {
    latestContext = { ...latestContext, ...context };
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    const step = currentStep ?? initialStep;
    addErrorLog("Config workflow failed", {
      operation,
      step,
      phase: step,
      transport: getTransportForStep(operation, step),
      status: "error",
      durationMs: Date.now() - startedAt,
      ...latestContext,
      error: resolvedError.message,
    });
  };

  return { emit, succeed, fail };
};

export const detectUpdatedTempConfigFile = (before: ConfigRemoteFile[], after: ConfigRemoteFile[]): ConfigRemoteFile | null => {
  const beforeMap = new Map(before.map((entry) => [entry.name, `${entry.size ?? -1}:${entry.modifiedAt ?? ""}`]));
  const changed = after
    .filter((entry) => entry.name.toLowerCase().endsWith(".cfg"))
    .filter((entry) => beforeMap.get(entry.name) !== `${entry.size ?? -1}:${entry.modifiedAt ?? ""}`)
    .sort((left, right) => {
      const leftTime = left.modifiedAt ? Date.parse(left.modifiedAt) : 0;
      const rightTime = right.modifiedAt ? Date.parse(right.modifiedAt) : 0;
      return rightTime - leftTime;
    });
  return changed[0] ?? null;
};

export const waitForTempConfigFile = async (
  before: ConfigRemoteFile[],
  listRemoteTempFiles: () => Promise<ConfigRemoteFile[]>,
  sleep: (ms: number) => Promise<void>,
  onProgress?: (state: ConfigProgressState) => void,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  intervalMs = DEFAULT_WAIT_INTERVAL_MS,
) => {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    onProgress?.({
      step: "waiting-for-file",
      title: "Waiting for config file",
      description: "The Ultimate can take around 30 seconds to finish saving the config file.",
      progress: Math.min(99, Math.round((attempt / attempts) * 100)),
    });
    const after = await listRemoteTempFiles();
    const file = detectUpdatedTempConfigFile(before, after);
    if (file) return file;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for the new config file in /Temp.");
};

export const createConfigWorkflow = (overrides: Partial<ConfigWorkflowDependencies> = {}) => {
  const deps = { ...defaultDependencies, ...overrides };

  const saveSnapshot = async (onProgress?: (state: ConfigProgressState) => void): Promise<SavedConfigSnapshot> => {
    const reporter = createProgressReporter("save", onProgress);
    let logContext: ConfigWorkflowLogContext = {};
    const emit = (state: ConfigProgressState, context: ConfigWorkflowLogContext = {}) => {
      logContext = { ...logContext, ...context };
      reporter.emit(state, logContext);
    };

    try {
      emit(
        {
          step: "preparing",
          title: "Preparing config save",
          description: "Checking local config snapshot storage.",
          progress: 5,
        },
        { remotePath: "/Temp" },
      );
      await deps.ensureLocalSnapshotStorage();

      emit(
        {
          step: "scanning-temp",
          title: "Scanning /Temp",
          description: "Capturing the current list of config files before saving.",
          progress: 10,
        },
        { remotePath: "/Temp" },
      );
      const before = await deps.listRemoteTempFiles();

      emit(
        {
          step: "saving-config",
          title: "Saving config on the Ultimate",
          description: "The menu action is running in /Temp.",
          progress: 20,
        },
        { remotePath: "/Temp" },
      );
      await deps.runSaveRemoteConfig();

      const remoteFile = await waitForTempConfigFile(before, deps.listRemoteTempFiles, deps.sleep, (state) =>
        emit(state, { remotePath: "/Temp" }),
      );

      emit(
        {
          step: "downloading",
          title: "Downloading config snapshot",
          description: `Downloading ${remoteFile.name} from /Temp.`,
          progress: 80,
        },
        { remoteFileName: remoteFile.name, remotePath: remoteFile.path },
      );
      const bytes = await deps.readRemoteFile(remoteFile.path);

      const now = deps.now();
      const localFileName = `c64u-config-${formatFileTimestamp(now)}.cfg`;
      emit(
        {
          step: "persisting",
          title: "Saving local config snapshot",
          description: "Writing the config file into local native storage.",
          progress: 90,
        },
        { localFileName, localPath: localFileName, remoteFileName: remoteFile.name, remotePath: remoteFile.path },
      );
      const storage = await deps.persistLocalSnapshot(localFileName, bytes);
      const resolvedLocalPath = describeStoragePath(storage);
      const result: SavedConfigSnapshot = {
        fileName: localFileName,
        createdAt: now.toISOString(),
        sizeBytes: bytes.byteLength,
        remoteFileName: remoteFile.name,
        storage,
      };
      emit(
        {
          step: "complete",
          title: "Config snapshot saved",
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
      return result;
    } catch (error) {
      reporter.fail(error, logContext);
      throw error;
    }
  };

  const applyLocalSnapshot = async (
    fileName: string,
    bytes: Uint8Array,
    onProgress?: (state: ConfigProgressState) => void,
  ) => {
    const reporter = createProgressReporter("apply-local", onProgress);
    const remoteFileName = normalizeConfigFileName(fileName);
    const remotePath = `/Temp/${remoteFileName}`;
    let logContext: ConfigWorkflowLogContext = { localFileName: fileName, localPath: fileName, remoteFileName, remotePath };
    const emit = (state: ConfigProgressState, context: ConfigWorkflowLogContext = {}) => {
      logContext = { ...logContext, ...context };
      reporter.emit(state, logContext);
    };

    try {
      emit({
        step: "reading-local",
        title: "Reading local config snapshot",
        description: `Preparing ${fileName} for upload.`,
        progress: 10,
      });

      emit({
        step: "uploading",
        title: "Uploading config snapshot",
        description: `Uploading ${remoteFileName} to /Temp.`,
        progress: 60,
      });
      await deps.writeRemoteFile(remotePath, bytes);

      emit({
        step: "restoring",
        title: "Applying config snapshot",
        description: `Applying ${remoteFileName} on the Ultimate.`,
        progress: 90,
      });
      await deps.runApplyRemoteConfig(remoteFileName);

      emit({
        step: "complete",
        title: "Config snapshot applied",
        description: remoteFileName,
        progress: 100,
      });
      reporter.succeed("complete", logContext);
      return { remoteFileName, remotePath };
    } catch (error) {
      reporter.fail(error, logContext);
      throw error;
    }
  };

  const applyRemoteSnapshot = async (remotePath: string, onProgress?: (state: ConfigProgressState) => void) => {
    const reporter = createProgressReporter("apply-remote", onProgress);
    const remoteFileName = normalizeConfigFileName(remotePath.split("/").pop() ?? "config.cfg");
    const logContext: ConfigWorkflowLogContext = { remoteFileName, remotePath };
    try {
      reporter.emit(
        {
          step: "restoring",
          title: "Applying config snapshot",
          description: `Applying ${remoteFileName} on the Ultimate.`,
          progress: 90,
        },
        logContext,
      );
      await deps.runApplyRemoteConfigByPath(remotePath);
      reporter.emit(
        {
          step: "complete",
          title: "Config snapshot applied",
          description: remoteFileName,
          progress: 100,
        },
        logContext,
      );
      reporter.succeed("complete", logContext);
      return { remoteFileName, remotePath };
    } catch (error) {
      reporter.fail(error, logContext);
      throw error;
    }
  };

  return { saveSnapshot, applyLocalSnapshot, applyRemoteSnapshot };
};
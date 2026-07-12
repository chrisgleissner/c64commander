/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { getRegisteredQueryClient } from "@/lib/query/queryClientRegistry";
import type { C64API } from "@/lib/c64api";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { getActiveAction } from "@/lib/tracing/actionTrace";
import { recordDeviceGuard, recordTraceError } from "@/lib/tracing/traceSession";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import { AUTOSTART_SEQUENCE, buildAutostartSequence } from "./autostart";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";
import {
  formatPlayCategory,
  getFileExtension,
  getMountTypeForExtension,
  getPlayCategory,
  type PlayFileCategory,
} from "./fileTypes";
import { mountDiskToDrive, resolveLocalDiskBlob } from "@/lib/disks/diskMount";
import { buildDiskWriteBackDependencies } from "@/lib/disks/diskWriteBackDependencies";
import { createDiskEntry } from "@/lib/disks/diskTypes";
import {
  fetchUltimateOriginBlob,
  isOriginOnSelectedDevice,
  type DeviceBoundContentOrigin,
} from "@/lib/savedDevices/deviceBoundOrigin";
import { base64ToUint8, createSslPayload } from "@/lib/sid/sidUtils";
import { loadDiskAutostartMode, type DiskAutostartMode } from "@/lib/config/appSettings";
import { loadFirstDiskPrgViaDma, type DiskImageType } from "./diskFirstPrg";

export type PlaySource = "local" | "ultimate" | "hvsc" | "commoserve";

export type LocalPlayFile =
  | File
  | {
      name: string;
      webkitRelativePath?: string;
      lastModified: number;
      arrayBuffer: () => Promise<ArrayBuffer>;
    };

export type PlayRequest = {
  source: PlaySource;
  path: string;
  origin?: DeviceBoundContentOrigin | null;
  file?: LocalPlayFile;
  songNr?: number;
  durationMs?: number;
};

export type PlayPlan = {
  category: PlayFileCategory;
  source: PlaySource;
  path: string;
  origin?: DeviceBoundContentOrigin | null;
  mountType?: string;
  file?: LocalPlayFile;
  songNr?: number;
  durationMs?: number;
};

type PhysicalDriveMode = "1541" | "1571" | "1581";
type PlaybackNotice = Readonly<{
  title: string;
  description?: string;
}>;

const DISK_AUTOPLAY_DRIVE_MODE_BY_EXTENSION: Partial<Record<string, PhysicalDriveMode>> = {
  d64: "1541",
  d71: "1571",
  d81: "1581",
};

// HARD19-022: drive modes that can READ a given image, not just the canonical
// authoring mode. A 1571 reads D64 media natively (it is backward-compatible
// with the 1541), so a deliberate 1571 configuration must not be silently
// forced to 1541 just to autoplay a D64. D71 (double-sided) needs a 1571; D81
// (3.5") needs a 1581. When the current mode is already in this set we leave it
// alone; only an incompatible (or unknown) mode triggers a switch.
const DISK_AUTOPLAY_COMPATIBLE_MODES_BY_EXTENSION: Partial<Record<string, PhysicalDriveMode[]>> = {
  d64: ["1541", "1571"],
  d71: ["1571"],
  d81: ["1581"],
};
const SID_SSL_PROPAGATION_PREFLIGHT_TIMEOUT_MS = 1200;

export const buildPlayPlan = (request: PlayRequest): PlayPlan => {
  const category = getPlayCategory(request.path);
  if (!category) {
    throw new Error("Unsupported file format.");
  }
  return {
    category,
    source: request.source,
    path: request.path,
    origin: request.origin ?? null,
    file: request.file,
    mountType: getMountTypeForExtension(request.path),
    songNr: request.songNr,
    durationMs: request.durationMs,
  };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeUltimatePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

const getDiskAutoplayDriveMode = (path: string): PhysicalDriveMode | null => {
  const extension = getFileExtension(path);
  return DISK_AUTOPLAY_DRIVE_MODE_BY_EXTENSION[extension] ?? null;
};

const getDiskAutoplayCompatibleModes = (path: string): PhysicalDriveMode[] | null => {
  const extension = getFileExtension(path);
  return DISK_AUTOPLAY_COMPATIBLE_MODES_BY_EXTENSION[extension] ?? null;
};

const DRIVE_LABEL: Record<"a" | "b", string> = { a: "A", b: "B" };

const getDriveInfo = (drives: Awaited<ReturnType<C64API["getDrives"]>>, drive: "a" | "b") => {
  const entry = drives.drives.find((item) => Object.prototype.hasOwnProperty.call(item, drive));
  return entry?.[drive] ?? null;
};

const ensureDiskAutoplayDriveReady = async (
  api: C64API,
  drive: "a" | "b",
  path: string,
  notify?: ((notice: PlaybackNotice) => void) | null,
) => {
  const desiredMode = getDiskAutoplayDriveMode(path);
  if (!desiredMode) return 8;

  if (
    typeof api.getDrives !== "function" ||
    typeof api.driveOn !== "function" ||
    typeof api.setDriveMode !== "function"
  ) {
    return 8;
  }

  const compatibleModes = getDiskAutoplayCompatibleModes(path);

  const drives = await api.getDrives();
  let driveInfo = getDriveInfo(drives, drive);
  let requiresRefresh = false;
  // HARD19-022 (D3): whether we powered on or reconfigured the drive, so the
  // Home/Disks drive-card query is invalidated afterwards and stops showing the
  // stale type/enabled state until the next poll.
  let didMutateDrive = false;

  if (driveInfo?.enabled === false) {
    await api.driveOn(drive);
    didMutateDrive = true;
    // HARD19-022: re-read after enabling so the mode decision below uses the
    // just-enabled drive's REAL type, not the stale pre-enable snapshot (which
    // could force a redundant setDriveMode on a drive that already matched).
    const enabledDrives = await api.getDrives();
    driveInfo = getDriveInfo(enabledDrives, drive);
  }

  // HARD19-022: only switch when the current mode cannot read the image. A
  // deliberate 1571 reading a D64 is fine and must be preserved — forcing 1541
  // silently destroys the user's drive configuration and resets the emulated
  // drive for no functional gain. Unknown/missing type falls through to a
  // switch (safe canonical default).
  const currentMode = driveInfo?.type;
  const modeIsCompatible =
    currentMode !== undefined && Boolean(compatibleModes?.includes(currentMode as PhysicalDriveMode));
  if (!modeIsCompatible) {
    await api.setDriveMode(drive, desiredMode);
    requiresRefresh = true;
    didMutateDrive = true;
    addLog("info", "Disk autoplay switched physical drive mode", {
      drive,
      from: currentMode ?? null,
      to: desiredMode,
      path,
    });
    // Surface the change: a deliberate configuration was altered for this disk,
    // so the user must be told rather than discovering it later (HARD19-022).
    notify?.({
      title: `Drive ${DRIVE_LABEL[drive]} switched to ${desiredMode}`,
      description: "The disk needed a different drive mode to load.",
    });
  }

  if (requiresRefresh) {
    const refreshedDrives = await api.getDrives();
    driveInfo = getDriveInfo(refreshedDrives, drive);
  }

  // HARD19-022 (D3): refresh the Home/Disks drive cards after any drive mutation
  // so they reflect the new power/mode instead of a stale cached value. Best
  // effort — no registered client during very early startup.
  if (didMutateDrive) {
    getRegisteredQueryClient()?.invalidateQueries({ queryKey: ["c64-drives"] });
  }

  return typeof driveInfo?.bus_id === "number" ? driveInfo.bus_id : 8;
};

const emitDurationPropagationEvent = (payload: {
  type: "ssl-propagation-failure" | "playback-no-duration";
  level: "error" | "warn" | "info";
  reason: string;
  path: string;
  songlengthEntryMs?: number;
  errorMessage?: string;
}) => {
  const eventContext = {
    type: payload.type,
    level: payload.level,
    reason: payload.reason,
    sourceKind: "ultimate",
    trackId: payload.path,
    songlengthEntryMs: payload.songlengthEntryMs ?? null,
    error: payload.errorMessage ?? null,
  };

  if (payload.level === "error") {
    addErrorLog("Ultimate SID SSL propagation failure", eventContext);
  } else if (payload.level === "warn") {
    addLog("warn", "Ultimate SID SSL propagation failed; direct playback fallback will be used", eventContext);
  } else {
    addLog("info", "Ultimate SID has no duration metadata", eventContext);
  }

  const activeAction = getActiveAction();
  if (activeAction) {
    recordDeviceGuard(activeAction, eventContext);
  }
};

const withPlaybackFirstAudioScope = async <T>(plan: PlayPlan, mode: string, run: () => Promise<T>) => {
  const scope = beginHvscPerfScope("playback:first-audio", {
    category: plan.category,
    source: plan.source,
    path: plan.path,
    songNr: plan.songNr ?? null,
    durationMs: plan.durationMs ?? null,
    mode,
  });
  try {
    const result = await run();
    endHvscPerfScope(scope, {
      outcome: "success",
      category: plan.category,
      source: plan.source,
      path: plan.path,
      songNr: plan.songNr ?? null,
      durationMs: plan.durationMs ?? null,
      mode,
    });
    return result;
  } catch (error) {
    const err = error as Error;
    endHvscPerfScope(scope, {
      outcome: "error",
      category: plan.category,
      source: plan.source,
      path: plan.path,
      songNr: plan.songNr ?? null,
      durationMs: plan.durationMs ?? null,
      mode,
      errorName: err.name,
      errorMessage: err.message,
    });
    throw error;
  }
};

const recordPlaybackBenchmarkSnapshot = (
  plan: PlayPlan,
  mode: string,
  benchmarkMetadata?: Record<string, unknown> | null,
) => {
  void recordSmokeBenchmarkSnapshot({
    scenario: "playback-start",
    state: "complete",
    metadata: {
      ...(benchmarkMetadata ?? {}),
      category: plan.category,
      source: plan.source,
      path: plan.path,
      songNr: plan.songNr ?? null,
      durationMs: plan.durationMs ?? null,
      mode,
    },
  });
};

const withSidPropagationPreflightDeadline = async <T>(promise: Promise<T>, path: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `SID SSL propagation preflight timed out after ${SID_SSL_PROPAGATION_PREFLIGHT_TIMEOUT_MS}ms for ${path}`,
        ),
      );
    }, SID_SSL_PROPAGATION_PREFLIGHT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

export const tryFetchUltimateSidBlob = async (path: string) => {
  const normalizedPath = normalizeUltimatePath(path);
  const { deviceHost: rawHost, password = "" } = getC64APIConfigSnapshot();
  const host = normalizeFtpHost(rawHost);
  try {
    const response = await readFtpFile({
      host,
      port: getStoredFtpPort(),
      password,
      path: normalizedPath,
    });
    const bytes = base64ToUint8(response.data);
    if (typeof response.sizeBytes === "number" && response.sizeBytes !== bytes.length) {
      addLog("warn", "FTP SID payload size mismatch", {
        path: normalizedPath,
        expectedBytes: response.sizeBytes,
        actualBytes: bytes.length,
      });
      return null;
    }
    return new Blob([bytes], { type: "application/octet-stream" });
  } catch (error) {
    addLog("debug", "FTP SID fetch failed", {
      path: normalizedPath,
      error: (error as Error).message,
    });
    return null;
  }
};

const injectDiskAutostart = async (api: C64API, payload: Uint8Array) => {
  const baseDelayMs = 250;
  const maxAttempts = 4;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await delay(baseDelayMs * Math.pow(1.6, attempt - 1));
    } else {
      await delay(baseDelayMs);
    }
    try {
      // HARD19-018: route through the shared keyboard-buffer queue so a disk
      // launch's autostart loop never races a concurrent remote-input keystroke
      // on $0277/$00C6 (both would poll $00C6==0 and write, garbling each other).
      await enqueueKeyboardBufferInjection(api, payload, {
        pollIntervalMs: 140,
        maxAttempts: 20,
      });
      addLog("info", "Disk autostart injected", { attempt: attempt + 1 });
      return;
    } catch (error) {
      lastError = error as Error;
      addLog("debug", "Disk autostart retry", {
        attempt: attempt + 1,
        error: lastError.message,
      });
    }
  }
  addErrorLog("Disk autostart failed", {
    error: lastError?.message ?? "Unknown error",
  });
  throw new Error("Disk autostart failed. Try again after the disk finishes mounting.");
};

const toBlob = async (file?: LocalPlayFile) => {
  if (!file) return null;
  if (file instanceof Blob) return file;
  try {
    const buffer = await file.arrayBuffer();
    return new Blob([buffer], { type: "application/octet-stream" });
  } catch (error) {
    const message = (error as Error).message || "Local file unavailable.";
    const isNetworkFailure = /failed to fetch|networkerror|network request failed/i.test(message);
    if (isNetworkFailure) {
      throw new Error("Local file unavailable. Re-add it to the playlist.");
    }
    throw error;
  }
};

export type PlayExecutionOptions = {
  drive?: "a" | "b";
  loadMode?: "run" | "load";
  resetBeforeMount?: boolean;
  rebootBeforeMount?: boolean;
  diskAutostartMode?: DiskAutostartMode;
  beforeLaunch?: (() => Promise<void>) | null;
  benchmarkMetadata?: Record<string, unknown> | null;
  skipSidSslPropagation?: boolean;
  notify?: ((notice: PlaybackNotice) => void) | null;
};

export const executePlayPlan = async (api: C64API, plan: PlayPlan, options: PlayExecutionOptions = {}) => {
  const drive = options.drive ?? "a";
  const loadMode = options.loadMode ?? "run";
  const rebootBeforeMount = options.rebootBeforeMount ?? false;
  const resetBeforeMount = options.resetBeforeMount ?? true;
  const resetDelayMs = 500;
  const diskAutostartMode = options.diskAutostartMode ?? loadDiskAutostartMode();
  const beforeLaunch = options.beforeLaunch ?? null;
  const benchmarkMetadata = options.benchmarkMetadata ?? null;
  const notify = options.notify ?? null;

  try {
    const selectedDeviceCanAccessOrigin = plan.source !== "ultimate" || isOriginOnSelectedDevice(plan.origin);
    const resolveOriginBlob = async () => {
      if (plan.source !== "ultimate" || !plan.origin || selectedDeviceCanAccessOrigin) {
        return null;
      }
      return fetchUltimateOriginBlob(plan.origin);
    };
    switch (plan.category) {
      case "sid": {
        if (beforeLaunch) {
          await beforeLaunch();
        }
        if (plan.source === "ultimate" && selectedDeviceCanAccessOrigin) {
          const hasSonglengthData = typeof plan.durationMs === "number" && plan.durationMs > 0;
          if (!hasSonglengthData || options.skipSidSslPropagation) {
            emitDurationPropagationEvent({
              type: "playback-no-duration",
              level: "info",
              reason: hasSonglengthData ? "ssl-propagation-skipped" : "no-songlength-entry",
              path: plan.path,
            });
            await withPlaybackFirstAudioScope(plan, "ultimate-direct", () => api.playSid(plan.path, plan.songNr));
            recordPlaybackBenchmarkSnapshot(plan, "ultimate-direct", benchmarkMetadata);
            return;
          }

          let propagationFailure: Error | null = null;
          try {
            const ftpBlob = await withSidPropagationPreflightDeadline(tryFetchUltimateSidBlob(plan.path), plan.path);
            if (!ftpBlob) {
              throw new Error("SID FTP fetch failed for SSL propagation");
            }
            const sslPayload = createSslPayload(plan.durationMs as number, { songNr: plan.songNr });
            const sslBlob = new Blob([sslPayload], {
              type: "application/octet-stream",
            });
            await withPlaybackFirstAudioScope(plan, "ultimate-ssl-upload", () =>
              api.playSidUpload(ftpBlob, plan.songNr, sslBlob, { filename: plan.path }),
            );
            recordPlaybackBenchmarkSnapshot(plan, "ultimate-ssl-upload", benchmarkMetadata);
            return;
          } catch (error) {
            propagationFailure = error as Error;
            const message = propagationFailure.message;
            const reason = /ftp|preflight|timed out/i.test(message)
              ? "ftp-fetch-failed"
              : /invalid sid duration|duration/i.test(message)
                ? "ssl-payload-invalid"
                : "upload-failed-with-songlength-available";
            emitDurationPropagationEvent({
              type: "ssl-propagation-failure",
              level: "warn",
              reason,
              path: plan.path,
              songlengthEntryMs: plan.durationMs,
              errorMessage: message,
            });
            addLog("warn", "Ultimate SID falling back to direct playback without SSL upload", {
              path: plan.path,
              reason,
              error: message,
            });
          }

          try {
            await withPlaybackFirstAudioScope(plan, "ultimate-direct-fallback", () =>
              api.playSid(plan.path, plan.songNr),
            );
            recordPlaybackBenchmarkSnapshot(plan, "ultimate-direct-fallback", benchmarkMetadata);
            return;
          } catch (fallbackError) {
            const err = fallbackError as Error;
            const fallbackContext = new Error(
              `Ultimate SID fallback playback failed after SSL propagation failure: ${err.message}`,
            );
            addErrorLog("Ultimate SID fallback playback failed", {
              path: plan.path,
              propagationError: propagationFailure?.message ?? null,
              fallbackError: err.message,
            });
            throw fallbackContext;
          }
        }
        const blob = (await resolveOriginBlob()) ?? (await toBlob(plan.file));
        if (!blob) throw new Error("Missing local SID data.");
        const sslBlob =
          plan.durationMs && plan.durationMs > 0
            ? new Blob([createSslPayload(plan.durationMs, { songNr: plan.songNr })], {
                type: "application/octet-stream",
              })
            : undefined;
        await withPlaybackFirstAudioScope(plan, "local-upload", () =>
          api.playSidUpload(blob, plan.songNr, sslBlob, { filename: plan.path }),
        );
        recordPlaybackBenchmarkSnapshot(plan, "local-upload", benchmarkMetadata);
        return;
      }
      case "mod": {
        if (beforeLaunch) {
          await beforeLaunch();
        }
        if (plan.source === "ultimate" && selectedDeviceCanAccessOrigin) {
          await api.playMod(plan.path);
          return;
        }
        const blob = (await resolveOriginBlob()) ?? (await toBlob(plan.file));
        if (!blob) throw new Error("Missing local MOD data.");
        await api.playModUpload(blob, { filename: plan.path });
        return;
      }
      case "prg": {
        if (beforeLaunch) {
          await beforeLaunch();
        }
        if (plan.source === "ultimate" && selectedDeviceCanAccessOrigin) {
          if (loadMode === "load") {
            await api.loadPrg(plan.path);
          } else {
            await api.runPrg(plan.path);
          }
          return;
        }
        const blob = (await resolveOriginBlob()) ?? (await toBlob(plan.file));
        if (!blob) throw new Error("Missing local PRG data.");
        if (loadMode === "load") {
          await api.loadPrgUpload(blob, { filename: plan.path });
        } else {
          await api.runPrgUpload(blob, { filename: plan.path });
        }
        return;
      }
      case "crt": {
        if (beforeLaunch) {
          await beforeLaunch();
        }
        if (plan.source === "ultimate" && selectedDeviceCanAccessOrigin) {
          await api.runCartridge(plan.path);
          return;
        }
        const blob = (await resolveOriginBlob()) ?? (await toBlob(plan.file));
        if (!blob) throw new Error("Missing local CRT data.");
        await api.runCartridgeUpload(blob, { filename: plan.path });
        return;
      }
      case "disk": {
        if (rebootBeforeMount) {
          await api.machineReboot();
          await delay(resetDelayMs);
        } else if (resetBeforeMount) {
          await api.machineReset();
          await delay(resetDelayMs);
        }

        const driveBusId = await ensureDiskAutoplayDriveReady(api, drive, plan.path, notify);

        // HARD19-008: mount through mountDiskToDrive with write-back deps so a
        // pending Home-mounted disk's saves on this drive are finalized (not
        // silently dropped) when Play mounts a different disk here.
        const diskWriteBack = buildDiskWriteBackDependencies();

        let localBlob: Blob | null = null;

        if (plan.source === "ultimate") {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: "ultimate",
            origin: plan.origin ?? null,
          });
          await mountDiskToDrive(api, drive, diskEntry, undefined, { writeBack: diskWriteBack });
        } else if (plan.file) {
          localBlob = await toBlob(plan.file);
          if (!localBlob) throw new Error("Missing local disk data.");
          // HARD19-008: route the local-file path through mountDiskToDrive (was a
          // raw mountDriveUpload that bypassed the write-back bookkeeping entirely,
          // leaving a stale materialized entry that a later eject misattributed).
          // Pass the resolved blob as the runtime file so no extra read occurs.
          const diskEntry = createDiskEntry({ path: plan.path, location: "local" });
          await mountDiskToDrive(api, drive, diskEntry, localBlob as File, { writeBack: diskWriteBack });
        } else {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: "local",
          });
          await mountDiskToDrive(api, drive, diskEntry, undefined, { writeBack: diskWriteBack });
        }

        if (beforeLaunch) {
          await beforeLaunch();
        }

        const diskType = getFileExtension(plan.path);
        const dmaEligible =
          diskAutostartMode === "dma" &&
          plan.source === "local" &&
          (diskType === "d64" || diskType === "d71" || diskType === "d81") &&
          localBlob;

        if (dmaEligible && localBlob) {
          const image = new Uint8Array(await localBlob.arrayBuffer());
          await loadFirstDiskPrgViaDma(api, image, diskType as DiskImageType);
        } else if (
          diskAutostartMode === "dma" &&
          plan.source === "local" &&
          !localBlob &&
          (diskType === "d64" || diskType === "d71" || diskType === "d81")
        ) {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: "local",
          });
          try {
            const blob = await resolveLocalDiskBlob(diskEntry);
            const image = new Uint8Array(await blob.arrayBuffer());
            await loadFirstDiskPrgViaDma(api, image, diskType as DiskImageType);
          } catch (error) {
            addLog("warn", "DMA disk autostart fallback to injection", {
              path: plan.path,
              error: (error as Error).message,
            });
            await injectDiskAutostart(api, buildAutostartSequence(driveBusId));
          }
        } else {
          await injectDiskAutostart(api, buildAutostartSequence(driveBusId));
        }
        return;
      }
      default: {
        const categoryLabel = formatPlayCategory(plan.category);
        throw new Error(`Unsupported playback type: ${categoryLabel}`);
      }
    }
  } catch (error) {
    const err = error as Error;
    const failure = classifyError(err);
    addErrorLog("Playback failed", {
      source: plan.source,
      path: plan.path,
      category: plan.category,
      error: err.message,
      errorCategory: failure.category,
      errorExpected: failure.isExpected,
    });
    const activeAction = getActiveAction();
    if (activeAction) {
      recordTraceError(activeAction, err, failure);
    }
    throw error;
  }
};

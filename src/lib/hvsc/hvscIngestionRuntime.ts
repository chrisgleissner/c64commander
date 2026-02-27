/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { HvscCacheStatus, HvscFolderListing, HvscIngestionState, HvscProgressEvent, HvscSong, HvscStatus, HvscUpdateStatus } from './hvscTypes';
import { buildHvscBaselineUrl, buildHvscUpdateUrl, fetchLatestHvscVersions } from './hvscReleaseService';
import {
  ensureHvscDirs,
  listHvscFolder,
  getHvscSongByVirtualPath,
  getHvscDurationByMd5,
  writeLibraryFile,
  deleteLibraryFile,
  resetLibraryRoot,
  resetSonglengthsCache,
} from './hvscFilesystem';
import { loadHvscState, updateHvscState, isUpdateApplied, markUpdateApplied } from './hvscStateStore';
import { loadHvscStatusSummary, saveHvscStatusSummary } from './hvscStatusStore';
import { getHvscSonglengthsStats, reloadHvscSonglengthsOnConfigChange } from './hvscSongLengthService';
import { addErrorLog, addLog } from '@/lib/logging';
import { classifyError } from '@/lib/tracing/failureTaxonomy';
import { buildSidTrackSubsongs, parseSidHeaderMetadata } from '@/lib/sid/sidUtils';
import { clearHvscBrowseIndexSnapshot, createHvscBrowseIndexMutable } from './hvscBrowseIndexStore';
import {
  resolveCachedArchive,
  getCacheStatusInternal,
  downloadArchive,
  readArchiveBuffer,
  ensureNotCancelledWith,
  normalizeEntryName,
  normalizeVirtualPath,
  normalizeLibraryPath,
  normalizeUpdateVirtualPath,
  normalizeUpdateLibraryPath,
  isDeletionList,
  parseDeletionList,
} from './hvscDownload';
import { extractArchiveEntries } from './hvscArchiveExtraction';
import { createArchivePipelineStateMachine, type HvscPipelineState, type PipelineStateMachine } from './hvscIngestionPipeline';
import { addHvscProgressListener as addProgressListener, createProgressEmitter, resetHvscProgressSummaryStage } from './hvscIngestionProgress';
import { HvscIngestion } from '@/lib/native/hvscIngestion';

// ── Module state ─────────────────────────────────────────────────

type HvscProgressListenerHandle = {
  remove: () => Promise<void>;
};

type HvscIngestionRuntimeState = {
  cancelTokens: Map<string, { cancelled: boolean }>;
  activeIngestionRunning: boolean;
  nativeListenersByToken: Map<string, Set<HvscProgressListenerHandle>>;
  cacheStatFailures: Map<string, number>;
};

const runtimeState: HvscIngestionRuntimeState = {
  cancelTokens: new Map<string, { cancelled: boolean }>(),
  activeIngestionRunning: false,
  nativeListenersByToken: new Map<string, Set<HvscProgressListenerHandle>>(),
  cacheStatFailures: new Map<string, number>(),
};

const CACHE_STAT_FAILURE_ESCALATION_THRESHOLD = 2;

const registerNativeProgressListener = (token: string, listener: HvscProgressListenerHandle) => {
  const listeners = runtimeState.nativeListenersByToken.get(token) ?? new Set<HvscProgressListenerHandle>();
  listeners.add(listener);
  runtimeState.nativeListenersByToken.set(token, listeners);
};

const removeNativeProgressListener = async (token: string, listener: HvscProgressListenerHandle) => {
  const listeners = runtimeState.nativeListenersByToken.get(token);
  try {
    await listener.remove();
  } catch (error) {
    addLog('warn', 'Failed to remove HVSC native progress listener', {
      token,
      error: (error as Error).message,
    });
  } finally {
    if (!listeners) {
      runtimeState.nativeListenersByToken.delete(token);
    } else {
      listeners.delete(listener);
      if (listeners.size === 0) {
        runtimeState.nativeListenersByToken.delete(token);
      }
    }
  }
};

const drainNativeProgressListeners = async (token?: string) => {
  const tokens = token ? [token] : Array.from(runtimeState.nativeListenersByToken.keys());
  for (const itemToken of tokens) {
    const listeners = runtimeState.nativeListenersByToken.get(itemToken);
    if (!listeners?.size) {
      runtimeState.nativeListenersByToken.delete(itemToken);
      continue;
    }
    const removals = Array.from(listeners);
    for (const listener of removals) {
      await removeNativeProgressListener(itemToken, listener);
    }
  }
};

const resetCacheStatFailure = (archiveName: string) => {
  runtimeState.cacheStatFailures.delete(archiveName);
};

const reportCacheStatFailure = (
  archiveName: string,
  error: unknown,
  emitProgress?: (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => void,
) => {
  const failures = (runtimeState.cacheStatFailures.get(archiveName) ?? 0) + 1;
  runtimeState.cacheStatFailures.set(archiveName, failures);
  const errorMessage = (error as Error).message;
  addLog('warn', 'HVSC cached archive stat failed', {
    archiveName,
    error: errorMessage,
    failureCount: failures,
  });
  if (failures >= CACHE_STAT_FAILURE_ESCALATION_THRESHOLD) {
    addErrorLog('HVSC cache health degraded', {
      archiveName,
      failureCount: failures,
      remediation: 'Re-download the archive from settings and retry ingestion.',
      error: {
        name: (error as Error).name,
        message: errorMessage,
        stack: (error as Error).stack,
      },
    });
    emitProgress?.({
      stage: 'warning',
      message: `Cache metadata check failed for ${archiveName}; re-download archive recommended`,
      archiveName,
      errorCause: errorMessage,
    });
  }
};

const formatPathListPreview = (paths: string[]) => {
  if (!paths.length) return 'none';
  const previewLimit = 10;
  const preview = paths.slice(0, previewLimit).join(', ');
  return paths.length > previewLimit ? `${preview} (+${paths.length - previewLimit} more)` : preview;
};

/** True while an ingestion task (install/update or cached ingest) is executing. */
export const isIngestionRuntimeActive = () => runtimeState.activeIngestionRunning;

// ── Cold-start recovery ──────────────────────────────────────────

/**
 * Detects and resets stale ingestion state left behind after an app crash.
 * If `ingestionState` is 'installing' or 'updating' but no runtime is active,
 * we know the previous run was interrupted. Resets state to 'error' and marks
 * any in-progress status summary steps as 'failure'.
 * Returns true if recovery was performed.
 */
export const recoverStaleIngestionState = (): boolean => {
  if (runtimeState.activeIngestionRunning) return false;
  const state = loadHvscState();
  if (state.ingestionState !== 'installing' && state.ingestionState !== 'updating') return false;
  addLog('warn', 'HVSC cold-start recovery: resetting stale ingestion state', {
    ingestionState: state.ingestionState,
  });
  updateHvscState({ ingestionState: 'error' as HvscIngestionState, ingestionError: 'Interrupted by app restart' });
  const summary = loadHvscStatusSummary();
  const now = new Date().toISOString();
  if (summary.download.status === 'in-progress' || summary.extraction.status === 'in-progress') {
    saveHvscStatusSummary({
      ...summary,
      download: summary.download.status === 'in-progress'
        ? { ...summary.download, status: 'failure', finishedAt: now, errorMessage: 'Interrupted by app restart', errorCategory: 'unknown' }
        : summary.download,
      extraction: summary.extraction.status === 'in-progress'
        ? { ...summary.extraction, status: 'failure', finishedAt: now, errorMessage: 'Interrupted by app restart', errorCategory: 'unknown' }
        : summary.extraction,
      lastUpdatedAt: now,
    });
  }
  return true;
};

const ensureNotCancelled = (token?: string) => {
  ensureNotCancelledWith(runtimeState.cancelTokens, token, (patch) => updateHvscState(patch as any));
};

const canUseNativeHvscIngestion = () => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('HvscIngestion');
  } catch (error) {
    addLog('warn', 'Failed to probe HvscIngestion native plugin', {
      error: (error as Error).message,
    });
    return false;
  }
};

const canUseNonNativeHvscIngestion = () => {
  if (import.meta.env.MODE === 'test') {
    return true;
  }
  if (import.meta.env.DEV) {
    return true;
  }
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1') {
    return true;
  }
  return import.meta.env.VITE_ENABLE_NON_NATIVE_HVSC_INGESTION === '1';
};

const resolveHvscIngestionMode = () => {
  if (canUseNativeHvscIngestion()) {
    return 'native' as const;
  }
  if (!canUseNonNativeHvscIngestion()) {
    addLog('warn', 'HVSC native ingestion plugin unavailable; falling back to non-native ingestion path', {
      nativeAvailable: false,
      overrideEnabled: false,
    });
  }
  return 'non-native' as const;
};

// ── Listener management ──────────────────────────────────────────

export const addHvscProgressListener = async (listener: (event: HvscProgressEvent) => void) => {
  return addProgressListener(listener);
};

// ── Status/cache queries ─────────────────────────────────────────

export const getHvscStatus = async (): Promise<HvscStatus> => loadHvscState();

export const getHvscCacheStatus = async (): Promise<HvscCacheStatus> => getCacheStatusInternal();

export const checkForHvscUpdates = async (): Promise<HvscUpdateStatus> => {
  const { baselineVersion, updateVersion } = await fetchLatestHvscVersions();
  const current = updateHvscState({ lastUpdateCheckUtcMs: Date.now() });
  const installedVersion = current.installedVersion ?? 0;
  const requiredUpdates = installedVersion === 0 && updateVersion > baselineVersion
    ? Array.from({ length: updateVersion - baselineVersion }, (_, i) => baselineVersion + i + 1)
    : installedVersion > 0 && installedVersion < updateVersion
      ? Array.from({ length: updateVersion - installedVersion }, (_, i) => installedVersion + i + 1)
      : [];
  return {
    latestVersion: updateVersion,
    installedVersion,
    baselineVersion,
    requiredUpdates,
  };
};

// ── Shared ingestion core ─────────────────────────────────────────

export type IngestArchiveBufferOptions = {
  plan: { type: 'baseline' | 'update'; version: number };
  archiveName: string;
  archiveBuffer: Uint8Array;
  cancelToken: string;
  cancelTokens: Map<string, { cancelled: boolean }>;
  emitProgress: (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => void;
  pipeline: PipelineStateMachine;
  baselineInstalled: number | null;
};

export type IngestArchiveBufferResult = {
  baselineInstalled: number | null;
};

/**
 * Shared core: extract archive buffer → classify entries → write SIDs/songlengths →
 * apply deletions → reload songlengths → update state.
 *
 * Pipeline state must be DOWNLOADED on entry. Transitions:
 * EXTRACTING → EXTRACTED → INGESTING → READY.
 */
export const ingestArchiveBuffer = async (options: IngestArchiveBufferOptions): Promise<IngestArchiveBufferResult> => {
  const { plan, archiveName, archiveBuffer, cancelToken, cancelTokens, emitProgress, pipeline } = options;
  let { baselineInstalled } = options;
  const ingestionSummary = {
    totalSongs: 0,
    ingestedSongs: 0,
    failedSongs: 0,
    songlengthSyntaxErrors: 0,
    failedPaths: [] as string[],
  };

  const ensureNotCancelledLocal = () => {
    if (cancelTokens.get(cancelToken)?.cancelled) {
      updateHvscState({ ingestionState: 'idle', ingestionError: 'Cancelled' });
      throw new Error('HVSC update cancelled');
    }
  };

  if (plan.type === 'baseline') {
    await resetLibraryRoot();
    baselineInstalled = plan.version;
  }

  const browseIndex = await createHvscBrowseIndexMutable(plan.type);

  const deletions: string[] = [];
  pipeline.transition('EXTRACTING');
  emitProgress({ stage: 'archive_extraction', message: `Extracting ${archiveName}…`, archiveName });

  await extractArchiveEntries({
    archiveName,
    buffer: archiveBuffer,
    onEnumerate: (total) => {
      emitProgress({
        stage: 'sid_enumeration',
        message: `Discovered ${total} files`,
        archiveName,
        processedCount: 0,
        totalCount: total,
      });
    },
    onProgress: (processed, total) => {
      emitProgress({
        stage: 'archive_extraction',
        message: `Extracting ${archiveName}…`,
        archiveName,
        processedCount: processed,
        totalCount: total,
        percent: total ? Math.round((processed / total) * 100) : undefined,
      });
    },
    onEntry: async (path, data) => {
      ensureNotCancelledLocal();
      const normalized = normalizeEntryName(path);
      if (isDeletionList(normalized)) {
        const text = new TextDecoder().decode(data);
        deletions.push(...parseDeletionList(text));
        return;
      }

      const lowered = normalized.toLowerCase();
      if (lowered.endsWith('songlengths.md5') || lowered.endsWith('songlengths.txt')) {
        const targetPath = plan.type === 'baseline'
          ? normalizeLibraryPath(normalized)
          : normalizeUpdateLibraryPath(normalized);
        if (targetPath) {
          await writeLibraryFile(targetPath, data);
          emitProgress({
            stage: 'songlengths',
            message: `Loaded ${targetPath.split('/').pop()}`,
            archiveName,
          });
        }
        return;
      }

      const virtualPath = plan.type === 'baseline'
        ? normalizeVirtualPath(normalized)
        : normalizeUpdateVirtualPath(normalized);
      if (!virtualPath) return;
      ingestionSummary.totalSongs += 1;
      try {
        let sidMetadata = null;
        let trackSubsongs = null;
        try {
          sidMetadata = parseSidHeaderMetadata(data);
          trackSubsongs = buildSidTrackSubsongs(sidMetadata.songs, sidMetadata.startSong);
        } catch (parseError) {
          const failure = classifyError(parseError);
          addLog('warn', 'HVSC SID metadata parse failed; continuing ingest', {
            virtualPath,
            archiveName,
            errorCategory: failure.category,
            errorExpected: failure.isExpected,
            error: (parseError as Error).message,
          });
        }
        await writeLibraryFile(virtualPath, data);
        browseIndex.upsertSong({
          virtualPath,
          fileName: virtualPath.split('/').pop() ?? virtualPath,
          sidMetadata,
          trackSubsongs,
        });
        ingestionSummary.ingestedSongs += 1;
        emitProgress({
          stage: 'sid_metadata_parsing',
          message: `Parsed ${virtualPath}`,
          archiveName,
          currentFile: virtualPath,
          totalSongs: ingestionSummary.totalSongs,
          ingestedSongs: ingestionSummary.ingestedSongs,
          failedSongs: ingestionSummary.failedSongs,
        });
      } catch (error) {
        const failure = classifyError(error);
        ingestionSummary.failedSongs += 1;
        ingestionSummary.failedPaths.push(virtualPath);
        addErrorLog('HVSC song ingest failed', {
          archiveName,
          virtualPath,
          errorCategory: failure.category,
          errorExpected: failure.isExpected,
          operation: 'writeLibraryFile',
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
        emitProgress({
          stage: 'sid_metadata_parsing',
          message: `Failed ${virtualPath}`,
          archiveName,
          currentFile: virtualPath,
          totalSongs: ingestionSummary.totalSongs,
          ingestedSongs: ingestionSummary.ingestedSongs,
          failedSongs: ingestionSummary.failedSongs,
        });
      }
    },
  });
  pipeline.transition('EXTRACTED');

  pipeline.transition('INGESTING', { deletionCount: deletions.length });
  const deletionFailures: string[] = [];
  if (deletions.length) {
    for (const path of deletions) {
      try {
        await deleteLibraryFile(path);
        browseIndex.deleteSong(path);
      } catch (error) {
        const failure = classifyError(error);
        addErrorLog('HVSC deletion failed', {
          path,
          errorCategory: failure.category,
          errorExpected: failure.isExpected,
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
        deletionFailures.push(path);
      }
    }
  }
  if (deletionFailures.length > 0) {
    addErrorLog('HVSC deletion manifest', {
      archiveName,
      failureCount: deletionFailures.length,
      failedPaths: deletionFailures,
      failedPathPreview: formatPathListPreview(deletionFailures),
    });
    throw new Error(`HVSC ingestion cleanup failed for ${deletionFailures.length} file(s): ${formatPathListPreview(deletionFailures)}. See diagnostics for full failure manifest.`);
  }

  resetSonglengthsCache();
  try {
    await reloadHvscSonglengthsOnConfigChange();
  } catch (error) {
    const failure = classifyError(error);
    addErrorLog('HVSC songlengths reload failed after ingestion', {
      archiveName,
      errorCategory: failure.category,
      errorExpected: failure.isExpected,
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    throw error;
  }
  ingestionSummary.songlengthSyntaxErrors = getHvscSonglengthsStats().backendStats.rejectedLines;

  if (ingestionSummary.failedSongs > 0) {
    const failedMessage = `HVSC ingestion failed: ${ingestionSummary.failedSongs} of ${ingestionSummary.totalSongs} songs could not be ingested (${ingestionSummary.failedPaths.slice(0, 10).join(', ')})`;
    updateHvscState({
      ingestionState: 'error',
      ingestionError: failedMessage,
      ingestionSummary: {
        ...ingestionSummary,
        completedAt: new Date().toISOString(),
        archiveName,
      },
    });
    throw new Error(failedMessage);
  }

  await browseIndex.finalize();

  updateHvscState({
    installedBaselineVersion: baselineInstalled,
    installedVersion: plan.version,
    ingestionState: 'ready',
    ingestionError: null,
    ingestionSummary: {
      ...ingestionSummary,
      completedAt: new Date().toISOString(),
      archiveName,
    },
  });
  if (plan.type === 'update') {
    markUpdateApplied(plan.version, 'success');
  }
  pipeline.transition('READY');
  emitProgress({
    stage: 'complete',
    message: `${archiveName} indexed`,
    archiveName,
    percent: 100,
    totalSongs: ingestionSummary.totalSongs,
    ingestedSongs: ingestionSummary.ingestedSongs,
    failedSongs: ingestionSummary.failedSongs,
    songlengthSyntaxErrors: ingestionSummary.songlengthSyntaxErrors,
  });

  return { baselineInstalled };
};

const ingestArchivePathNative = async (options: {
  plan: { type: 'baseline' | 'update'; version: number };
  archivePath: string;
  archiveName: string;
  cancelToken: string;
  emitProgress: (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => void;
  pipeline: PipelineStateMachine;
  baselineInstalled: number | null;
}): Promise<{ baselineInstalled: number | null }> => {
  const {
    plan,
    archivePath,
    archiveName,
    cancelToken,
    emitProgress,
    pipeline,
  } = options;
  let { baselineInstalled } = options;

  if (plan.type === 'baseline') {
    baselineInstalled = plan.version;
  }

  pipeline.transition('EXTRACTING');
  emitProgress({ stage: 'archive_extraction', message: `Extracting ${archiveName}…`, archiveName });

  const { getHvscCacheDir } = await import('./hvscFilesystem');
  const relativeArchivePath = `${getHvscCacheDir()}/${archivePath}`;

  const progressListener = await HvscIngestion.addProgressListener((nativeEvent) => {
    emitProgress({
      stage: nativeEvent.stage || 'archive_extraction',
      message: nativeEvent.message || `Processing ${archiveName}…`,
      archiveName,
      currentFile: nativeEvent.currentFile,
      processedCount: nativeEvent.processedCount,
      totalCount: nativeEvent.totalCount,
      percent: nativeEvent.percent,
      songsUpserted: nativeEvent.songsUpserted,
      songsDeleted: nativeEvent.songsDeleted,
    });
  });
  registerNativeProgressListener(cancelToken, progressListener);

  try {
    ensureNotCancelled(cancelToken);
    const result = await HvscIngestion.ingestHvsc({
      relativeArchivePath,
      mode: plan.type,
      resetLibrary: plan.type === 'baseline',
      dbBatchSize: 500,
      minExpectedRows: plan.type === 'baseline' ? 1 : 0,
      progressEvery: 250,
      debugHeapLogging: import.meta.env.DEV,
    });
    ensureNotCancelled(cancelToken);

    pipeline.transition('EXTRACTED');
    pipeline.transition('INGESTING', { deletionCount: result.songsDeleted });

    resetSonglengthsCache();
    await reloadHvscSonglengthsOnConfigChange();
    await clearHvscBrowseIndexSnapshot();

    if (result.failedSongs > 0) {
      const failedMessage = `HVSC ingestion failed: ${result.failedSongs} of ${result.songsIngested + result.failedSongs} songs could not be ingested (${result.failedPaths.slice(0, 10).join(', ')})`;
      updateHvscState({
        ingestionState: 'error',
        ingestionError: failedMessage,
        ingestionSummary: {
          totalSongs: result.songsIngested + result.failedSongs,
          ingestedSongs: result.songsIngested,
          failedSongs: result.failedSongs,
          songlengthSyntaxErrors: getHvscSonglengthsStats().backendStats.rejectedLines,
          failedPaths: result.failedPaths,
          completedAt: new Date().toISOString(),
          archiveName,
        },
      });
      throw new Error(failedMessage);
    }

    updateHvscState({
      installedBaselineVersion: baselineInstalled,
      installedVersion: plan.version,
      ingestionState: 'ready',
      ingestionError: null,
      ingestionSummary: {
        totalSongs: result.metadataRows,
        ingestedSongs: result.songsIngested,
        failedSongs: result.failedSongs,
        songlengthSyntaxErrors: getHvscSonglengthsStats().backendStats.rejectedLines,
        failedPaths: result.failedPaths,
        completedAt: new Date().toISOString(),
        archiveName,
      },
    });

    if (plan.type === 'update') {
      markUpdateApplied(plan.version, 'success');
    }
    pipeline.transition('READY');
    emitProgress({
      stage: 'complete',
      message: `${archiveName} indexed`,
      archiveName,
      percent: 100,
      totalSongs: result.metadataRows,
      ingestedSongs: result.songsIngested,
      failedSongs: result.failedSongs,
      songlengthSyntaxErrors: getHvscSonglengthsStats().backendStats.rejectedLines,
      songsDeleted: result.songsDeleted,
    });
    return { baselineInstalled };
  } finally {
    await removeNativeProgressListener(cancelToken, progressListener);
  }
};

// ── Install / update (from network) ─────────────────────────────

export const installOrUpdateHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  if (runtimeState.activeIngestionRunning) {
    const error = new Error('HVSC ingestion already running');
    addErrorLog('HVSC install/update blocked', { error: error.message });
    throw error;
  }
  resetHvscProgressSummaryStage();
  runtimeState.activeIngestionRunning = true;
  const ingestionId = crypto.randomUUID();
  const emitProgress = createProgressEmitter(ingestionId);
  emitProgress({ stage: 'start', message: 'HVSC install/update started' });
  await ensureHvscDirs();
  runtimeState.cancelTokens.set(cancelToken, { cancelled: false });

  let currentArchive: string | null = null;
  let currentArchiveType: 'baseline' | 'update' | null = null;
  let currentArchiveVersion: number | null = null;
  let currentArchiveComplete = false;
  let currentPipelineState: HvscPipelineState | null = null;
  let baselineInstalled: number | null = null;
  try {
    const { baselineVersion, updateVersion, baseUrl } = await fetchLatestHvscVersions();
    updateHvscState({ lastUpdateCheckUtcMs: Date.now() });
    const current = loadHvscState();
    baselineInstalled = current.installedBaselineVersion ?? null;
    const plans: Array<{ type: 'baseline' | 'update'; version: number }> = [];
    if (!current.installedVersion) {
      plans.push({ type: 'baseline', version: baselineVersion });
    }
    const startVersion = current.installedVersion || baselineVersion;
    if (startVersion < updateVersion) {
      for (let version = startVersion + 1; version <= updateVersion; version += 1) {
        plans.push({ type: 'update', version });
      }
    }

    if (!plans.length) {
      emitProgress({ stage: 'complete', message: 'HVSC already up to date' });
      return loadHvscState();
    }

    emitProgress({
      stage: 'archive_discovery',
      message: `Discovered ${plans.length} archive(s)`,
      processedCount: 0,
      totalCount: plans.length,
    });

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      if (plan.type === 'update' && isUpdateApplied(plan.version)) {
        emitProgress({
          stage: 'archive_discovery',
          message: `Update ${plan.version} already applied`,
          processedCount: index + 1,
          totalCount: plans.length,
        });
        continue;
      }
      const prefix = plan.type === 'baseline' ? 'hvsc-baseline' : 'hvsc-update';
      const archiveName = `${prefix}-${plan.version}.7z`;
      currentArchive = archiveName;
      currentArchiveType = plan.type;
      currentArchiveVersion = plan.version;
      currentArchiveComplete = false;
      const pipeline = createArchivePipelineStateMachine({
        archiveName,
        archiveType: plan.type,
        archiveVersion: plan.version,
      });
      currentPipelineState = pipeline.current();
      emitProgress({
        stage: 'archive_discovery',
        message: `Preparing ${plan.type === 'baseline' ? 'HVSC' : 'update'} ${plan.version}`,
        archiveName,
        processedCount: index + 1,
        totalCount: plans.length,
      });

      const cached = await resolveCachedArchive(prefix, plan.version);
      const archivePath = cached ?? archiveName;
      const ingestionMode = resolveHvscIngestionMode();
      updateHvscState({
        ingestionState: plan.type === 'baseline' ? 'installing' : 'updating',
        ingestionError: null,
      });
      pipeline.transition('DOWNLOADING', { cached: Boolean(cached) });
      currentPipelineState = pipeline.current();
      if (!cached) {
        const downloadUrl = plan.type === 'baseline'
          ? buildHvscBaselineUrl(plan.version, baseUrl)
          : buildHvscUpdateUrl(plan.version, baseUrl);
        const downloadedBuffer = await downloadArchive({
          plan,
          archiveName,
          archivePath,
          downloadUrl,
          cancelToken,
          cancelTokens: runtimeState.cancelTokens,
          emitProgress,
          retainInMemoryBuffer: ingestionMode === 'non-native',
        });
        currentArchiveComplete = true;
        pipeline.transition('DOWNLOADED', { cached: false });
        currentPipelineState = pipeline.current();

        ensureNotCancelled(cancelToken);
        emitProgress({
          stage: 'archive_validation',
          message: `Validated ${archiveName}`,
          archiveName,
        });

        const result = ingestionMode === 'native'
          ? await ingestArchivePathNative({
            plan,
            archivePath,
            archiveName,
            cancelToken,
            emitProgress,
            pipeline,
            baselineInstalled,
          })
          : await ingestArchiveBuffer({
            plan,
            archiveName: archivePath,
            archiveBuffer: downloadedBuffer ?? await readArchiveBuffer(archivePath),
            cancelToken,
            cancelTokens: runtimeState.cancelTokens,
            emitProgress,
            pipeline,
            baselineInstalled,
          });
        baselineInstalled = result.baselineInstalled;
        currentPipelineState = pipeline.current();
        continue;
      } else {
        currentArchiveComplete = true;
        try {
          const cacheDir = (await import('./hvscFilesystem')).getHvscCacheDir();
          const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${archivePath}` });
          resetCacheStatFailure(cached);
          emitProgress({
            stage: 'download',
            message: `Using cached ${archiveName}`,
            archiveName: cached,
            downloadedBytes: stat.size,
            totalBytes: stat.size,
            percent: 100,
          });
        } catch (error) {
          reportCacheStatFailure(cached, error, emitProgress);
          emitProgress({
            stage: 'download',
            message: `Using cached ${archiveName}`,
            archiveName: cached,
            percent: 100,
          });
        }
      }
      pipeline.transition('DOWNLOADED', { cached: Boolean(cached) });
      currentPipelineState = pipeline.current();

      ensureNotCancelled(cancelToken);
      emitProgress({
        stage: 'archive_validation',
        message: `Validated ${archiveName}`,
        archiveName,
      });

      const result = ingestionMode === 'native'
        ? await ingestArchivePathNative({
          plan,
          archivePath,
          archiveName,
          cancelToken,
          emitProgress,
          pipeline,
          baselineInstalled,
        })
        : await ingestArchiveBuffer({
          plan,
          archiveName: archivePath,
          archiveBuffer: await readArchiveBuffer(archivePath),
          cancelToken,
          cancelTokens: runtimeState.cancelTokens,
          emitProgress,
          pipeline,
          baselineInstalled,
        });
      baselineInstalled = result.baselineInstalled;
      currentPipelineState = pipeline.current();
    }

    return loadHvscState();
  } catch (error) {
    const failure = classifyError(error);
    if (currentArchiveType === 'update' && currentArchiveVersion) {
      markUpdateApplied(currentArchiveVersion, 'failed', (error as Error).message);
    }
    if (currentArchive && !currentArchiveComplete) {
      const { deleteCachedArchive } = await import('./hvscFilesystem');
      await deleteCachedArchive(currentArchive);
    }
    addErrorLog('HVSC install/update failed', {
      ingestionId,
      archiveName: currentArchive ?? undefined,
      archiveType: currentArchiveType,
      archiveVersion: currentArchiveVersion,
      pipelineState: currentPipelineState,
      errorCategory: failure.category,
      errorExpected: failure.isExpected,
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    updateHvscState({ ingestionState: 'error', ingestionError: (error as Error).message });
    emitProgress({
      stage: 'error',
      message: (error as Error).message,
      archiveName: currentArchive ?? undefined,
      errorCause: (error as Error).message,
    });
    throw error;
  } finally {
    await drainNativeProgressListeners(cancelToken);
    runtimeState.activeIngestionRunning = false;
    runtimeState.cancelTokens.delete(cancelToken);
  }
};

// ── Ingest cached (from previously downloaded archives) ──────────

export const ingestCachedHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  if (runtimeState.activeIngestionRunning) {
    const error = new Error('HVSC ingestion already running');
    addErrorLog('HVSC cached ingestion blocked', { error: error.message });
    throw error;
  }
  runtimeState.activeIngestionRunning = true;
  const ingestionId = crypto.randomUUID();
  const emitProgress = createProgressEmitter(ingestionId);
  emitProgress({ stage: 'start', message: 'HVSC cached ingestion started' });
  await ensureHvscDirs();
  runtimeState.cancelTokens.set(cancelToken, { cancelled: false });

  let currentArchive: string | null = null;
  let currentArchiveType: 'baseline' | 'update' | null = null;
  let currentArchiveVersion: number | null = null;
  let currentPipelineState: HvscPipelineState | null = null;
  let baselineInstalled: number | null = null;
  try {
    const cache = await getCacheStatusInternal();
    const current = loadHvscState();
    baselineInstalled = current.installedBaselineVersion ?? null;
    const plans: Array<{ type: 'baseline' | 'update'; version: number }> = [];
    if (!current.installedVersion) {
      if (!cache.baselineVersion) {
        throw new Error('No cached HVSC archives available.');
      }
      plans.push({ type: 'baseline', version: cache.baselineVersion });
    }
    const startVersion = current.installedVersion || cache.baselineVersion || 0;
    const updates = cache.updateVersions.filter((version) => version > startVersion);
    updates.forEach((version) => plans.push({ type: 'update', version }));

    if (!plans.length) {
      if (!cache.baselineVersion) {
        throw new Error('No cached HVSC archives available.');
      }
      const installedBaselineVersion = current.installedBaselineVersion ?? 0;
      if (cache.baselineVersion <= installedBaselineVersion) {
        emitProgress({
          stage: 'archive_discovery',
          message: 'No new HVSC archives to ingest',
          processedCount: 0,
          totalCount: 0,
        });
        return current;
      }
      plans.push({ type: 'baseline', version: cache.baselineVersion });
      cache.updateVersions
        .filter((version) => version > cache.baselineVersion!)
        .forEach((version) => plans.push({ type: 'update', version }));
    }

    emitProgress({ stage: 'archive_discovery', message: `Discovered ${plans.length} cached archive(s)`, processedCount: 0, totalCount: plans.length });

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      if (plan.type === 'update' && isUpdateApplied(plan.version)) {
        emitProgress({
          stage: 'archive_discovery',
          message: `Update ${plan.version} already applied`,
          processedCount: index + 1,
          totalCount: plans.length,
        });
        continue;
      }
      const prefix = plan.type === 'baseline' ? 'hvsc-baseline' : 'hvsc-update';
      const cached = await resolveCachedArchive(prefix, plan.version);
      if (!cached) {
        throw new Error('No cached HVSC archives available.');
      }
      const ingestionMode = resolveHvscIngestionMode();
      currentArchive = cached;
      currentArchiveType = plan.type;
      currentArchiveVersion = plan.version;
      const pipeline = createArchivePipelineStateMachine({
        archiveName: cached,
        archiveType: plan.type,
        archiveVersion: plan.version,
      });
      currentPipelineState = pipeline.current();
      emitProgress({ stage: 'archive_discovery', message: `Preparing cached ${cached}`, archiveName: cached, processedCount: index + 1, totalCount: plans.length });

      pipeline.transition('DOWNLOADING', { cached: true });
      currentPipelineState = pipeline.current();

      try {
        const cacheDir = (await import('./hvscFilesystem')).getHvscCacheDir();
        const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${cached}` });
        resetCacheStatFailure(cached);
        emitProgress({
          stage: 'download',
          message: `Using cached ${cached}`,
          archiveName: cached,
          downloadedBytes: stat.size,
          totalBytes: stat.size,
          percent: 100,
        });
      } catch (error) {
        reportCacheStatFailure(cached, error, emitProgress);
        emitProgress({ stage: 'download', message: `Using cached ${cached}`, archiveName: cached, percent: 100 });
      }
      pipeline.transition('DOWNLOADED', { cached: true });
      currentPipelineState = pipeline.current();

      if (plan.type === 'baseline') {
        updateHvscState({ ingestionState: 'installing', ingestionError: null });
      } else {
        updateHvscState({ ingestionState: 'updating', ingestionError: null });
      }

      const result = ingestionMode === 'native'
        ? await ingestArchivePathNative({
          plan,
          archivePath: cached,
          archiveName: cached,
          cancelToken,
          emitProgress,
          pipeline,
          baselineInstalled,
        })
        : await ingestArchiveBuffer({
          plan,
          archiveName: cached,
          archiveBuffer: await readArchiveBuffer(cached),
          cancelToken,
          cancelTokens: runtimeState.cancelTokens,
          emitProgress,
          pipeline,
          baselineInstalled,
        });
      baselineInstalled = result.baselineInstalled;
      currentPipelineState = pipeline.current();
    }

    return loadHvscState();
  } catch (error) {
    const failure = classifyError(error);
    if (currentArchiveType === 'update' && currentArchiveVersion) {
      markUpdateApplied(currentArchiveVersion, 'failed', (error as Error).message);
    }
    addErrorLog('HVSC cached ingest failed', {
      ingestionId,
      archiveName: currentArchive ?? undefined,
      archiveType: currentArchiveType,
      archiveVersion: currentArchiveVersion,
      pipelineState: currentPipelineState,
      errorCategory: failure.category,
      errorExpected: failure.isExpected,
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    updateHvscState({ ingestionState: 'error', ingestionError: (error as Error).message });
    emitProgress({ stage: 'error', message: (error as Error).message, archiveName: currentArchive ?? undefined, errorCause: (error as Error).message });
    throw error;
  } finally {
    await drainNativeProgressListeners(cancelToken);
    runtimeState.activeIngestionRunning = false;
    runtimeState.cancelTokens.delete(cancelToken);
  }
};

// ── Cancel ───────────────────────────────────────────────────────

export const cancelHvscInstall = async (cancelToken: string): Promise<void> => {
  if (!runtimeState.cancelTokens.has(cancelToken)) {
    runtimeState.cancelTokens.set(cancelToken, { cancelled: true });
  } else {
    runtimeState.cancelTokens.get(cancelToken)!.cancelled = true;
  }
  await drainNativeProgressListeners(cancelToken);
  if (canUseNativeHvscIngestion()) {
    try {
      await HvscIngestion.cancelIngestion();
    } catch (error) {
      addLog('warn', 'Failed to cancel native HVSC ingestion', {
        token: cancelToken,
        error: (error as Error).message,
      });
    }
  }
  updateHvscState({ ingestionState: 'idle', ingestionError: 'Cancelled' });
  addLog('info', 'HVSC cancel requested', { token: cancelToken });
};

// ── Folder / song / duration queries ─────────────────────────────

export const getHvscFolderListing = async (path: string): Promise<HvscFolderListing> => listHvscFolder(path);

export const getHvscSong = async (options: { id?: number; virtualPath?: string }): Promise<HvscSong> => {
  if (!options.virtualPath) throw new Error('Song not found');
  const song = await getHvscSongByVirtualPath(options.virtualPath);
  if (!song) throw new Error('Song not found');
  return song;
};

export const getHvscDurationByMd5Seconds = async (md5: string) => getHvscDurationByMd5(md5);

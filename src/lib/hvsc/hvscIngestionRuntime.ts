/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
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
import { reloadHvscSonglengthsOnConfigChange } from './hvscSongLengthService';
import { addErrorLog, addLog } from '@/lib/logging';
import { classifyError } from '@/lib/tracing/failureTaxonomy';
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

// ── Module state ─────────────────────────────────────────────────

const cancelTokens = new Map<string, { cancelled: boolean }>();
let activeIngestionRunning = false;

/** True while an ingestion task (install/update or cached ingest) is executing. */
export const isIngestionRuntimeActive = () => activeIngestionRunning;

// ── Cold-start recovery ──────────────────────────────────────────

/**
 * Detects and resets stale ingestion state left behind after an app crash.
 * If `ingestionState` is 'installing' or 'updating' but no runtime is active,
 * we know the previous run was interrupted. Resets state to 'error' and marks
 * any in-progress status summary steps as 'failure'.
 * Returns true if recovery was performed.
 */
export const recoverStaleIngestionState = (): boolean => {
  if (activeIngestionRunning) return false;
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
  ensureNotCancelledWith(cancelTokens, token, (patch) => updateHvscState(patch as any));
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
      await writeLibraryFile(virtualPath, data);
      emitProgress({
        stage: 'sid_metadata_parsing',
        message: `Parsed ${virtualPath}`,
        archiveName,
        currentFile: virtualPath,
      });
    },
  });
  pipeline.transition('EXTRACTED');

  pipeline.transition('INGESTING', { deletionCount: deletions.length });
  if (deletions.length) {
    for (const path of deletions) {
      try {
        await deleteLibraryFile(path);
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
      }
    }
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
  }

  updateHvscState({
    installedBaselineVersion: baselineInstalled,
    installedVersion: plan.version,
    ingestionState: 'ready',
    ingestionError: null,
  });
  if (plan.type === 'update') {
    markUpdateApplied(plan.version, 'success');
  }
  pipeline.transition('READY');
  emitProgress({ stage: 'complete', message: `${archiveName} indexed`, archiveName, percent: 100 });

  return { baselineInstalled };
};

// ── Install / update (from network) ─────────────────────────────

export const installOrUpdateHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  if (activeIngestionRunning) {
    const error = new Error('HVSC ingestion already running');
    addErrorLog('HVSC install/update blocked', { error: error.message });
    throw error;
  }
  resetHvscProgressSummaryStage();
  activeIngestionRunning = true;
  const ingestionId = crypto.randomUUID();
  const emitProgress = createProgressEmitter(ingestionId);
  emitProgress({ stage: 'start', message: 'HVSC install/update started' });
  await ensureHvscDirs();
  cancelTokens.set(cancelToken, { cancelled: false });

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
        await downloadArchive({
          plan,
          archiveName,
          archivePath,
          downloadUrl,
          cancelToken,
          cancelTokens,
          emitProgress,
        });
        currentArchiveComplete = true;
      } else {
        currentArchiveComplete = true;
        try {
          const cacheDir = (await import('./hvscFilesystem')).getHvscCacheDir();
          const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${archivePath}` });
          emitProgress({
            stage: 'download',
            message: `Using cached ${archiveName}`,
            archiveName: cached,
            downloadedBytes: stat.size,
            totalBytes: stat.size,
            percent: 100,
          });
        } catch (error) {
          const failure = classifyError(error);
          addLog('warn', 'HVSC cached archive stat failed', {
            archiveName: cached,
            error: (error as Error).message,
            errorCategory: failure.category,
            errorExpected: failure.isExpected,
          });
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
      const archiveBuffer = await readArchiveBuffer(archivePath);

      emitProgress({
        stage: 'archive_validation',
        message: `Validated ${archiveName}`,
        archiveName,
      });

      const result = await ingestArchiveBuffer({
        plan,
        archiveName: archivePath,
        archiveBuffer,
        cancelToken,
        cancelTokens,
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
    activeIngestionRunning = false;
    cancelTokens.delete(cancelToken);
  }
};

// ── Ingest cached (from previously downloaded archives) ──────────

export const ingestCachedHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  if (activeIngestionRunning) {
    const error = new Error('HVSC ingestion already running');
    addErrorLog('HVSC cached ingestion blocked', { error: error.message });
    throw error;
  }
  activeIngestionRunning = true;
  const ingestionId = crypto.randomUUID();
  const emitProgress = createProgressEmitter(ingestionId);
  emitProgress({ stage: 'start', message: 'HVSC cached ingestion started' });
  await ensureHvscDirs();
  cancelTokens.set(cancelToken, { cancelled: false });

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

      const archiveBuffer = await readArchiveBuffer(cached);
      pipeline.transition('DOWNLOADING', { cached: true });
      currentPipelineState = pipeline.current();

      try {
        const cacheDir = (await import('./hvscFilesystem')).getHvscCacheDir();
        const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${cached}` });
        emitProgress({
          stage: 'download',
          message: `Using cached ${cached}`,
          archiveName: cached,
          downloadedBytes: stat.size,
          totalBytes: stat.size,
          percent: 100,
        });
      } catch (error) {
        const failure = classifyError(error);
        addLog('warn', 'HVSC cached archive stat failed', {
          archiveName: cached,
          error: (error as Error).message,
          errorCategory: failure.category,
          errorExpected: failure.isExpected,
        });
        emitProgress({ stage: 'download', message: `Using cached ${cached}`, archiveName: cached, percent: 100 });
      }
      pipeline.transition('DOWNLOADED', { cached: true });
      currentPipelineState = pipeline.current();

      if (plan.type === 'baseline') {
        updateHvscState({ ingestionState: 'installing', ingestionError: null });
      } else {
        updateHvscState({ ingestionState: 'updating', ingestionError: null });
      }

      const result = await ingestArchiveBuffer({
        plan,
        archiveName: cached,
        archiveBuffer,
        cancelToken,
        cancelTokens,
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
    activeIngestionRunning = false;
    cancelTokens.delete(cancelToken);
  }
};

// ── Cancel ───────────────────────────────────────────────────────

export const cancelHvscInstall = async (cancelToken: string): Promise<void> => {
  if (!cancelTokens.has(cancelToken)) {
    cancelTokens.set(cancelToken, { cancelled: true });
  } else {
    cancelTokens.get(cancelToken)!.cancelled = true;
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

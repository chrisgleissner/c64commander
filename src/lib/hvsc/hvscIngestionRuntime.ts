import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { HvscCacheStatus, HvscFolderListing, HvscIngestionState, HvscProgressEvent, HvscSong, HvscStatus, HvscUpdateStatus } from './hvscTypes';
import { buildHvscBaselineUrl, buildHvscUpdateUrl, fetchLatestHvscVersions } from './hvscReleaseService';
import { extractArchiveEntries } from './hvscArchiveExtraction';
import {
  ensureHvscDirs,
  getHvscCacheDir,
  listHvscFolder,
  getHvscSongByVirtualPath,
  getHvscDurationByMd5,
  resetLibraryRoot,
  writeLibraryFile,
  deleteLibraryFile,
  resetSonglengthsCache,
  writeCachedArchive,
  deleteCachedArchive,
  readCachedArchiveMarker,
  writeCachedArchiveMarker,
} from './hvscFilesystem';
import { loadHvscState, markUpdateApplied, updateHvscState, isUpdateApplied } from './hvscStateStore';
import { updateHvscStatusSummaryFromEvent, loadHvscStatusSummary, saveHvscStatusSummary } from './hvscStatusStore';
import { reloadHvscSonglengthsOnConfigChange } from './hvscSongLengthService';
import { base64ToUint8 } from '@/lib/sid/sidUtils';
import { addErrorLog, addLog } from '@/lib/logging';

const listeners = new Set<(event: HvscProgressEvent) => void>();
const cancelTokens = new Map<string, { cancelled: boolean }>();

let summaryLastStage: string | null = null;
let activeIngestionRunning = false;

/** True while an ingestion task (install/update or cached ingest) is executing. */
export const isIngestionRuntimeActive = () => activeIngestionRunning;

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

type HvscPipelineState =
  | 'IDLE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'EXTRACTING'
  | 'EXTRACTED'
  | 'INGESTING'
  | 'READY';

const hvscPipelineTransitions: Record<HvscPipelineState, HvscPipelineState[]> = {
  IDLE: ['DOWNLOADING'],
  DOWNLOADING: ['DOWNLOADED'],
  DOWNLOADED: ['EXTRACTING'],
  EXTRACTING: ['EXTRACTED'],
  EXTRACTED: ['INGESTING'],
  INGESTING: ['READY'],
  READY: [],
};

const createArchivePipelineStateMachine = (params: {
  archiveName: string;
  archiveType: 'baseline' | 'update';
  archiveVersion: number;
}) => {
  let state: HvscPipelineState = 'IDLE';
  const transition = (next: HvscPipelineState, details: Record<string, unknown> = {}) => {
    const allowed = hvscPipelineTransitions[state];
    if (!allowed.includes(next)) {
      const error = new Error(`Illegal HVSC pipeline transition ${state} -> ${next}`);
      addErrorLog('HVSC pipeline transition violation', {
        archiveName: params.archiveName,
        archiveType: params.archiveType,
        archiveVersion: params.archiveVersion,
        fromState: state,
        toState: next,
        details,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
      throw error;
    }
    addLog('info', 'HVSC pipeline transition', {
      archiveName: params.archiveName,
      archiveType: params.archiveType,
      archiveVersion: params.archiveVersion,
      fromState: state,
      toState: next,
      details,
    });
    state = next;
  };
  return {
    transition,
    current: () => state,
  };
};

const emit = (event: HvscProgressEvent) => {
  const lastStage = summaryLastStage;
  if (event.stage && event.stage !== 'error') {
    summaryLastStage = event.stage;
  }
  updateHvscStatusSummaryFromEvent(event, lastStage);
  listeners.forEach((listener) => listener(event));
};

const normalizeEntryName = (raw: string) => raw.replace(/\\/g, '/').replace(/^\/+/, '');
const getErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    if ('error' in error) {
      const nested = (error as { error?: unknown }).error;
      if (typeof nested === 'string') return nested;
      if (nested && typeof nested === 'object' && 'message' in nested) {
        const nestedMessage = (nested as { message?: unknown }).message;
        if (typeof nestedMessage === 'string') return nestedMessage;
      }
    }
  }
  return String(error ?? '');
};

const isExistsError = (error: unknown) => /exists|already exists/i.test(getErrorMessage(error));
const isTestProbeEnabled = () => {
  try {
    if (import.meta.env?.VITE_ENABLE_TEST_PROBES === '1') return true;
  } catch {
    // ignore
  }
  return typeof process !== 'undefined' && process.env?.VITE_ENABLE_TEST_PROBES === '1';
};

const shouldUseNativeDownload = () => {
  if (isTestProbeEnabled()) return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const parseContentLength = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const fetchContentLength = async (url: string) => {
  if (typeof fetch === 'undefined') return null;
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return null;
    return parseContentLength(response.headers.get('content-length'));
  } catch {
    return null;
  }
};

const concatChunks = (chunks: Uint8Array[], totalLength?: number | null) => {
  const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    buffer.set(chunk, offset);
    offset += chunk.length;
  });
  return buffer;
};

const normalizeVirtualPath = (entryName: string) => {
  const name = normalizeEntryName(entryName)
    .replace(/^HVSC\//i, '')
    .replace(/^C64Music\//i, '')
    .replace(/^C64MUSIC\//i, '');
  return name.toLowerCase().endsWith('.sid') ? `/${name.replace(/^\/+/, '')}` : null;
};

const normalizeLibraryPath = (entryName: string) => {
  const name = normalizeEntryName(entryName)
    .replace(/^HVSC\//i, '')
    .replace(/^C64Music\//i, '')
    .replace(/^C64MUSIC\//i, '')
    .replace(/^\/+/, '');
  return name ? `/${name}` : null;
};

const stripHvscRoot = (entryName: string) =>
  normalizeEntryName(entryName)
    .replace(/^HVSC\//i, '')
    .replace(/^C64Music\//i, '')
    .replace(/^C64MUSIC\//i, '');

const normalizeUpdateVirtualPath = (entryName: string) => {
  const stripped = stripHvscRoot(entryName);
  const lowered = stripped.toLowerCase();
  const base = lowered.startsWith('new/')
    ? stripped.substring(4)
    : lowered.startsWith('update/')
      ? stripped.substring(7)
      : lowered.startsWith('updated/')
        ? stripped.substring(8)
        : stripped;
  return normalizeVirtualPath(base);
};

const normalizeUpdateLibraryPath = (entryName: string) => {
  const stripped = stripHvscRoot(entryName);
  const lowered = stripped.toLowerCase();
  const base = lowered.startsWith('new/')
    ? stripped.substring(4)
    : lowered.startsWith('update/')
      ? stripped.substring(7)
      : lowered.startsWith('updated/')
        ? stripped.substring(8)
        : stripped;
  return normalizeLibraryPath(base);
};

const isDeletionList = (path: string) => {
  const lowered = path.toLowerCase();
  return lowered.endsWith('.txt') && (lowered.includes('delete') || lowered.includes('remove'));
};

const parseDeletionList = (content: string) =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.toLowerCase().endsWith('.sid'))
    .map((line) => (line.startsWith('/') ? line : `/${line}`));

const parseCachedVersion = (prefix: string, name: string) => {
  const match = new RegExp(`^${prefix}-(\\d+)(\\..+)?$`, 'i').exec(name);
  return match ? Number(match[1]) : null;
};

const emitDownloadProgress = (
  emitProgress: (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => void,
  archiveName: string,
  downloadedBytes?: number | null,
  totalBytes?: number | null,
) => {
  emitProgress({
    stage: 'download',
    message: `Downloading ${archiveName}…`,
    archiveName,
    downloadedBytes: downloadedBytes ?? undefined,
    totalBytes: totalBytes ?? undefined,
    percent: totalBytes ? Math.round(((downloadedBytes ?? 0) / totalBytes) * 100) : undefined,
  });
};

const resolveCachedArchive = async (prefix: string, version: number) => {
  const cacheDir = getHvscCacheDir();
  const candidates = [
    `${prefix}-${version}`,
    `${prefix}-${version}.7z`,
    `${prefix}-${version}.zip`,
  ];
  for (const name of candidates) {
    try {
      const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${name}` });
      if (stat.type === 'file' || stat.type === 'directory') {
        const marker = await readCachedArchiveMarker(name);
        if (marker) return name;
        await deleteCachedArchive(name);
      }
    } catch {
      // ignore
    }
  }
  return null;
};

const getCacheStatusInternal = async (): Promise<HvscCacheStatus> => {
  const cacheDir = getHvscCacheDir();
  let files: Array<string | { name?: string }> = [];
  try {
    const result = await Filesystem.readdir({ directory: Directory.Data, path: cacheDir });
    files = result.files ?? [];
  } catch {
    return { baselineVersion: null, updateVersions: [] };
  }
  const names = files.map((entry) => (typeof entry === 'string' ? entry : entry.name ?? '')).filter(Boolean);
  const markerNames = names.filter((name) => name.endsWith('.complete.json'));
  const normalizeMarker = (name: string) => name.replace(/\.complete\.json$/i, '');
  const baselineVersions = markerNames
    .map((name) => parseCachedVersion('hvsc-baseline', normalizeMarker(name)))
    .filter((v): v is number => !!v);
  const updateVersions = markerNames
    .map((name) => parseCachedVersion('hvsc-update', normalizeMarker(name)))
    .filter((v): v is number => !!v);
  return {
    baselineVersion: baselineVersions.length ? Math.max(...baselineVersions) : null,
    updateVersions: Array.from(new Set(updateVersions)).sort((a, b) => a - b),
  };
};

const createEmitter = (ingestionId: string) => {
  const startedAt = Date.now();
  return (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => {
    emit({
      ...event,
      ingestionId,
      elapsedTimeMs: Date.now() - startedAt,
    });
  };
};

const ensureNotCancelled = (token?: string) => {
  if (!token) return;
  if (cancelTokens.get(token)?.cancelled) {
    updateHvscState({ ingestionState: 'idle', ingestionError: 'Cancelled' });
    throw new Error('HVSC update cancelled');
  }
};

export const addHvscProgressListener = async (listener: (event: HvscProgressEvent) => void) => {
  listeners.add(listener);
  return {
    remove: async () => {
      listeners.delete(listener);
    },
  };
};

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

export const installOrUpdateHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  if (activeIngestionRunning) {
    const error = new Error('HVSC ingestion already running');
    addErrorLog('HVSC install/update blocked', { error: error.message });
    throw error;
  }
  summaryLastStage = null;
  activeIngestionRunning = true;
  const ingestionId = crypto.randomUUID();
  const emitProgress = createEmitter(ingestionId);
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
      const cacheDir = getHvscCacheDir();
      const archivePath = cached ?? archiveName;
      updateHvscState({
        ingestionState: plan.type === 'baseline' ? 'installing' : 'updating',
        ingestionError: null,
      });
      pipeline.transition('DOWNLOADING', { cached: Boolean(cached) });
      currentPipelineState = pipeline.current();
      if (!cached) {
        ensureNotCancelled(cancelToken);
        emitProgress({ stage: 'download', message: `Downloading ${archiveName}…`, archiveName, percent: 0 });
        await deleteCachedArchive(archivePath);
        const downloadUrl = plan.type === 'baseline'
          ? buildHvscBaselineUrl(plan.version, baseUrl)
          : buildHvscUpdateUrl(plan.version, baseUrl);
        addLog('info', 'HVSC download started', { archiveName, url: downloadUrl });
        const totalBytesHint = await fetchContentLength(downloadUrl);
        if (shouldUseNativeDownload()) {
          let lastReported = 0;
          let pollingTimer: ReturnType<typeof setInterval> | null = null;
          let totalBytes = totalBytesHint ?? null;
          const pollSize = async () => {
            try {
              const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${archivePath}` });
              const size = stat.size ?? 0;
              if (size > lastReported) {
                lastReported = size;
                emitDownloadProgress(emitProgress, archiveName, size, totalBytes);
              }
            } catch {
              // ignore
            }
          };
          try {
            pollingTimer = setInterval(pollSize, 400);
            await Filesystem.downloadFile({
              url: downloadUrl,
              directory: Directory.Data,
              path: `${cacheDir}/${archivePath}`,
              progress: (status) => {
                totalBytes = status.total ?? totalBytes;
                const loaded = status.loaded ?? 0;
                if (loaded >= lastReported) {
                  lastReported = loaded;
                  emitDownloadProgress(emitProgress, archiveName, loaded, totalBytes);
                }
              },
            });
            ensureNotCancelled(cancelToken);
          } catch (error) {
            await deleteCachedArchive(archivePath);
            if (!isExistsError(error)) throw error;
            ensureNotCancelled(cancelToken);
            const response = await fetch(downloadUrl, { cache: 'no-store' });
            if (!response.ok) {
              throw new Error(`Download failed: ${response.status} ${response.statusText}`);
            }
            const buffer = new Uint8Array(await response.arrayBuffer());
            await writeCachedArchive(archivePath, buffer);
            emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, buffer.byteLength);
          } finally {
            if (pollingTimer) clearInterval(pollingTimer);
          }
        } else {
          ensureNotCancelled(cancelToken);
          const response = await fetch(downloadUrl, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`Download failed: ${response.status} ${response.statusText}`);
          }
          const totalBytes = parseContentLength(response.headers.get('content-length')) ?? totalBytesHint;
          if (!response.body) {
            const buffer = new Uint8Array(await response.arrayBuffer());
            await writeCachedArchive(archivePath, buffer);
            emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, buffer.byteLength);
          } else {
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let loaded = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                loaded += value.length;
                emitDownloadProgress(emitProgress, archiveName, loaded, totalBytes ?? null);
              }
              ensureNotCancelled(cancelToken);
            }
            const buffer = concatChunks(chunks, totalBytes ?? undefined);
            await writeCachedArchive(archivePath, buffer);
            emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, totalBytes ?? buffer.byteLength);
          }
        }
        addLog('info', 'HVSC download completed', { archiveName });
        try {
          const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${archivePath}` });
          await writeCachedArchiveMarker(archivePath, {
            version: plan.version,
            type: plan.type,
            sizeBytes: stat.size,
            completedAt: new Date().toISOString(),
          });
          currentArchiveComplete = true;
          emitProgress({
            stage: 'download',
            message: `Downloaded ${archiveName}`,
            archiveName,
            downloadedBytes: stat.size,
            totalBytes: stat.size,
            percent: 100,
          });
        } catch {
          await writeCachedArchiveMarker(archivePath, {
            version: plan.version,
            type: plan.type,
            sizeBytes: null,
            completedAt: new Date().toISOString(),
          });
          currentArchiveComplete = true;
        }
      } else {
        currentArchiveComplete = true;
        try {
          const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${archivePath}` });
          emitProgress({
            stage: 'download',
            message: `Using cached ${archiveName}`,
            archiveName: cached,
            downloadedBytes: stat.size,
            totalBytes: stat.size,
            percent: 100,
          });
        } catch {
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
      const archiveData = await Filesystem.readFile({
        directory: Directory.Data,
        path: `${cacheDir}/${archivePath}`,
      });
      const archiveBuffer = base64ToUint8(archiveData.data);

      emitProgress({
        stage: 'archive_validation',
        message: `Validated ${archiveName}`,
        archiveName,
      });

      if (plan.type === 'baseline') {
        await resetLibraryRoot();
        baselineInstalled = plan.version;
      }

      const deletions: string[] = [];
      pipeline.transition('EXTRACTING');
      currentPipelineState = pipeline.current();
      emitProgress({ stage: 'archive_extraction', message: `Extracting ${archiveName}…`, archiveName });

      await extractArchiveEntries({
        archiveName: archivePath,
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
          ensureNotCancelled(cancelToken);
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
      currentPipelineState = pipeline.current();

      pipeline.transition('INGESTING', { deletionCount: deletions.length });
      currentPipelineState = pipeline.current();
      if (deletions.length) {
        for (const path of deletions) {
          try {
            await deleteLibraryFile(path);
          } catch {
            // ignore
          }
        }
      }

      resetSonglengthsCache();
      try {
        await reloadHvscSonglengthsOnConfigChange();
      } catch (error) {
        addErrorLog('HVSC songlengths reload failed after ingestion', {
          archiveName,
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
      currentPipelineState = pipeline.current();
      emitProgress({ stage: 'complete', message: `${archiveName} indexed`, archiveName, percent: 100 });
    }

    return loadHvscState();
  } catch (error) {
    if (currentArchive && !currentArchiveComplete) {
      await deleteCachedArchive(currentArchive);
    }
    addErrorLog('HVSC install/update failed', {
      ingestionId,
      archiveName: currentArchive ?? undefined,
      archiveType: currentArchiveType,
      archiveVersion: currentArchiveVersion,
      pipelineState: currentPipelineState,
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

export const ingestCachedHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  if (activeIngestionRunning) {
    const error = new Error('HVSC ingestion already running');
    addErrorLog('HVSC cached ingestion blocked', { error: error.message });
    throw error;
  }
  activeIngestionRunning = true;
  const ingestionId = crypto.randomUUID();
  const emitProgress = createEmitter(ingestionId);
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
        .filter((version) => version > cache.baselineVersion)
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

      const cacheDir = getHvscCacheDir();
      const archiveData = await Filesystem.readFile({ directory: Directory.Data, path: `${cacheDir}/${cached}` });
      const archiveBuffer = base64ToUint8(archiveData.data);
      pipeline.transition('DOWNLOADING', { cached: true });
      currentPipelineState = pipeline.current();

      try {
        const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${cached}` });
        emitProgress({
          stage: 'download',
          message: `Using cached ${cached}`,
          archiveName: cached,
          downloadedBytes: stat.size,
          totalBytes: stat.size,
          percent: 100,
        });
      } catch {
        emitProgress({ stage: 'download', message: `Using cached ${cached}`, archiveName: cached, percent: 100 });
      }
      pipeline.transition('DOWNLOADED', { cached: true });
      currentPipelineState = pipeline.current();

      if (plan.type === 'baseline') {
        updateHvscState({ ingestionState: 'installing', ingestionError: null });
        await resetLibraryRoot();
        baselineInstalled = plan.version;
      } else {
        updateHvscState({ ingestionState: 'updating', ingestionError: null });
      }

      const deletions: string[] = [];
      pipeline.transition('EXTRACTING');
      currentPipelineState = pipeline.current();
      emitProgress({ stage: 'archive_extraction', message: `Extracting ${cached}…`, archiveName: cached });

      await extractArchiveEntries({
        archiveName: cached,
        buffer: archiveBuffer,
        onEnumerate: (total) => {
          emitProgress({
            stage: 'sid_enumeration',
            message: `Discovered ${total} files`,
            archiveName: cached,
            processedCount: 0,
            totalCount: total,
          });
        },
        onProgress: (processed, total) => {
          emitProgress({ stage: 'archive_extraction', message: `Extracting ${cached}…`, archiveName: cached, processedCount: processed, totalCount: total, percent: total ? Math.round((processed / total) * 100) : undefined });
        },
        onEntry: async (path, data) => {
          ensureNotCancelled(cancelToken);
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
              emitProgress({ stage: 'songlengths', message: `Loaded ${targetPath.split('/').pop()}`, archiveName: cached });
            }
            return;
          }
          const virtualPath = plan.type === 'baseline'
            ? normalizeVirtualPath(normalized)
            : normalizeUpdateVirtualPath(normalized);
          if (!virtualPath) return;
          await writeLibraryFile(virtualPath, data);
          emitProgress({ stage: 'sid_metadata_parsing', message: `Parsed ${virtualPath}`, archiveName: cached, currentFile: virtualPath });
        },
      });
      pipeline.transition('EXTRACTED');
      currentPipelineState = pipeline.current();

      pipeline.transition('INGESTING', { deletionCount: deletions.length });
      currentPipelineState = pipeline.current();
      if (deletions.length) {
        for (const path of deletions) {
          try {
            await deleteLibraryFile(path);
          } catch {
            // ignore
          }
        }
      }

      resetSonglengthsCache();
      try {
        await reloadHvscSonglengthsOnConfigChange();
      } catch (error) {
        addErrorLog('HVSC songlengths reload failed after cached ingest', {
          archiveName: cached,
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
      currentPipelineState = pipeline.current();
      emitProgress({ stage: 'complete', message: `${cached} indexed`, archiveName: cached, percent: 100 });
    }

    return loadHvscState();
  } catch (error) {
    addErrorLog('HVSC cached ingest failed', {
      ingestionId,
      archiveName: currentArchive ?? undefined,
      archiveType: currentArchiveType,
      archiveVersion: currentArchiveVersion,
      pipelineState: currentPipelineState,
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

export const cancelHvscInstall = async (cancelToken: string): Promise<void> => {
  if (!cancelTokens.has(cancelToken)) {
    cancelTokens.set(cancelToken, { cancelled: true });
  } else {
    cancelTokens.get(cancelToken)!.cancelled = true;
  }
  updateHvscState({ ingestionState: 'idle', ingestionError: 'Cancelled' });
  addLog('info', 'HVSC cancel requested', { token: cancelToken });
};

export const getHvscFolderListing = async (path: string): Promise<HvscFolderListing> => listHvscFolder(path);

export const getHvscSong = async (options: { id?: number; virtualPath?: string }): Promise<HvscSong> => {
  if (!options.virtualPath) throw new Error('Song not found');
  const song = await getHvscSongByVirtualPath(options.virtualPath);
  if (!song) throw new Error('Song not found');
  return song;
};

export const getHvscDurationByMd5Seconds = async (md5: string) => getHvscDurationByMd5(md5);

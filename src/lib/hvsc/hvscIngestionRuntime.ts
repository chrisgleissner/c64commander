import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { HvscCacheStatus, HvscFolderListing, HvscProgressEvent, HvscSong, HvscStatus, HvscUpdateStatus } from './hvscTypes';
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
import { base64ToUint8 } from '@/lib/sid/sidUtils';
import { addErrorLog } from '@/lib/logging';

const listeners = new Set<(event: HvscProgressEvent) => void>();
const cancelTokens = new Map<string, { cancelled: boolean }>();

const emit = (event: HvscProgressEvent) => {
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
const shouldUseNativeDownload = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === '1') return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
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
  const ingestionId = crypto.randomUUID();
  const emitProgress = createEmitter(ingestionId);
  emitProgress({ stage: 'start', message: 'HVSC install/update started' });
  await ensureHvscDirs();
  cancelTokens.set(cancelToken, { cancelled: false });

  let currentArchive: string | null = null;
  let currentArchiveType: 'baseline' | 'update' | null = null;
  let currentArchiveVersion: number | null = null;
  let currentArchiveComplete = false;
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
      if (!cached) {
        emitProgress({ stage: 'download', message: `Downloading ${archiveName}…`, archiveName, percent: 0 });
        await deleteCachedArchive(archivePath);
        const downloadUrl = plan.type === 'baseline'
          ? buildHvscBaselineUrl(plan.version, baseUrl)
          : buildHvscUpdateUrl(plan.version, baseUrl);
        if (shouldUseNativeDownload()) {
          try {
            await Filesystem.downloadFile({
              url: downloadUrl,
              directory: Directory.Data,
              path: `${cacheDir}/${archivePath}`,
              progress: (status) => {
                emitProgress({
                  stage: 'download',
                  message: `Downloading ${archiveName}…`,
                  archiveName,
                  downloadedBytes: status.loaded,
                  totalBytes: status.total,
                  percent: status.total ? Math.round((status.loaded / status.total) * 100) : undefined,
                });
              },
            });
          } catch (error) {
            await deleteCachedArchive(archivePath);
            if (!isExistsError(error)) throw error;
            const response = await fetch(downloadUrl, { cache: 'no-store' });
            if (!response.ok) {
              throw new Error(`Download failed: ${response.status} ${response.statusText}`);
            }
            const buffer = new Uint8Array(await response.arrayBuffer());
            await writeCachedArchive(archivePath, buffer);
            emitProgress({
              stage: 'download',
              message: `Downloaded ${archiveName}`,
              archiveName,
              downloadedBytes: buffer.byteLength,
              totalBytes: buffer.byteLength,
              percent: 100,
            });
          }
        } else {
          const response = await fetch(downloadUrl, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`Download failed: ${response.status} ${response.statusText}`);
          }
          const buffer = new Uint8Array(await response.arrayBuffer());
          await writeCachedArchive(archivePath, buffer);
          emitProgress({
            stage: 'download',
            message: `Downloaded ${archiveName}`,
            archiveName,
            downloadedBytes: buffer.byteLength,
            totalBytes: buffer.byteLength,
            percent: 100,
          });
        }
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
        updateHvscState({ ingestionState: 'installing', ingestionError: null });
        await resetLibraryRoot();
        baselineInstalled = plan.version;
      } else {
        updateHvscState({ ingestionState: 'updating', ingestionError: null });
      }

      const deletions: string[] = [];
      emitProgress({ stage: 'archive_extraction', message: `Extracting ${archiveName}…`, archiveName });

      await extractArchiveEntries({
        archiveName: archivePath,
        buffer: archiveBuffer,
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
      updateHvscState({
        installedBaselineVersion: baselineInstalled,
        installedVersion: plan.version,
        ingestionState: 'ready',
        ingestionError: null,
      });
      if (plan.type === 'update') {
        markUpdateApplied(plan.version, 'success');
      }
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
    cancelTokens.delete(cancelToken);
  }
};

export const ingestCachedHvsc = async (cancelToken: string): Promise<HvscStatus> => {
  const ingestionId = crypto.randomUUID();
  const emitProgress = createEmitter(ingestionId);
  emitProgress({ stage: 'start', message: 'HVSC cached ingestion started' });
  await ensureHvscDirs();
  cancelTokens.set(cancelToken, { cancelled: false });

  let currentArchive: string | null = null;
  let currentArchiveType: 'baseline' | 'update' | null = null;
  let currentArchiveVersion: number | null = null;
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
      if (cache.baselineVersion) {
        plans.push({ type: 'baseline', version: cache.baselineVersion });
        cache.updateVersions
          .filter((version) => version > cache.baselineVersion)
          .forEach((version) => plans.push({ type: 'update', version }));
      } else {
        throw new Error('No cached HVSC archives available.');
      }
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
      emitProgress({ stage: 'archive_discovery', message: `Preparing cached ${cached}`, archiveName: cached, processedCount: index + 1, totalCount: plans.length });

      const cacheDir = getHvscCacheDir();
      const archiveData = await Filesystem.readFile({ directory: Directory.Data, path: `${cacheDir}/${cached}` });
      const archiveBuffer = base64ToUint8(archiveData.data);

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

      if (plan.type === 'baseline') {
        updateHvscState({ ingestionState: 'installing', ingestionError: null });
        await resetLibraryRoot();
        baselineInstalled = plan.version;
      } else {
        updateHvscState({ ingestionState: 'updating', ingestionError: null });
      }

      const deletions: string[] = [];
      emitProgress({ stage: 'archive_extraction', message: `Extracting ${cached}…`, archiveName: cached });

      await extractArchiveEntries({
        archiveName: cached,
        buffer: archiveBuffer,
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
      updateHvscState({
        installedBaselineVersion: baselineInstalled,
        installedVersion: plan.version,
        ingestionState: 'ready',
        ingestionError: null,
      });
      if (plan.type === 'update') {
        markUpdateApplied(plan.version, 'success');
      }
      emitProgress({ stage: 'complete', message: `${cached} indexed`, archiveName: cached, percent: 100 });
    }

    return loadHvscState();
  } catch (error) {
    addErrorLog('HVSC cached ingest failed', {
      ingestionId,
      archiveName: currentArchive ?? undefined,
      archiveType: currentArchiveType,
      archiveVersion: currentArchiveVersion,
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
    cancelTokens.delete(cancelToken);
  }
};

export const cancelHvscInstall = async (cancelToken: string): Promise<void> => {
  if (!cancelTokens.has(cancelToken)) {
    cancelTokens.set(cancelToken, { cancelled: true });
  } else {
    cancelTokens.get(cancelToken)!.cancelled = true;
  }
};

export const getHvscFolderListing = async (path: string): Promise<HvscFolderListing> => listHvscFolder(path);

export const getHvscSong = async (options: { id?: number; virtualPath?: string }): Promise<HvscSong> => {
  if (!options.virtualPath) throw new Error('Song not found');
  const song = await getHvscSongByVirtualPath(options.virtualPath);
  if (!song) throw new Error('Song not found');
  return song;
};

export const getHvscDurationByMd5Seconds = async (md5: string) => getHvscDurationByMd5(md5);

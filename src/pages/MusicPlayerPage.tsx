import { wrapUserEvent } from '@/lib/tracing/userTrace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music, Shuffle, SkipBack, SkipForward, Play, Folder, FolderOpen } from 'lucide-react';
import { Button, StatefulButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSidPlayer } from '@/hooks/useSidPlayer';
import { toast } from '@/hooks/use-toast';
import { addErrorLog, addLog } from '@/lib/logging';
import { reportUserError } from '@/lib/uiErrors';
import {
  addHvscProgressListener,
  checkForHvscUpdates,
  getHvscCacheStatus,
  getHvscStatus,
  ingestCachedHvsc,
  installOrUpdateHvsc,
  isHvscBridgeAvailable,
  resolveHvscSonglength,
  type HvscStatus,
  type HvscUpdateStatus,
  HvscSongSource,
} from '@/lib/hvsc';
import { calculateHvscProgress } from '@/lib/hvsc/hvscProgress';
import { createLocalFsSongSource, type LocalSidFile } from '@/lib/sources/LocalFsSongSource';
import { ingestLocalArchives } from '@/lib/sources/localArchiveIngestion';
import { browseLocalSidFiles, filterLocalInputFiles, prepareDirectoryInput } from '@/lib/sources/localFsPicker';
import type { SongEntry, SongFolder, SongSource } from '@/lib/sources/SongSource';

const formatTime = (ms?: number) => {
  if (!ms && ms !== 0) return '—';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatBytes = (bytes?: number | null) => {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
};

const HVSC_PROGRESS_LOG_INTERVAL = 500;

const mergeLocalSongMetadata = (current: SongEntry[], filePath: string, nextEntries: SongEntry[]) =>
  [...current.filter((entry) => entry.path !== filePath), ...nextEntries]
    .sort((left, right) => left.path.localeCompare(right.path) || (left.songNr ?? 1) - (right.songNr ?? 1));

export default function MusicPlayerPage() {
  const {
    queue,
    currentTrack,
    elapsedMs,
    durationMs,
    shuffle,
    isPlaying,
    setShuffle,
    playQueue,
    playTrack,
    next,
    previous,
  } = useSidPlayer();

  const [hvscStatus, setHvscStatus] = useState<HvscStatus | null>(null);
  const [hvscLoading, setHvscLoading] = useState(false);
  const [hvscProgress, setHvscProgress] = useState<number | null>(null);
  const [hvscStage, setHvscStage] = useState<string | null>(null);
  const [hvscIngestionId, setHvscIngestionId] = useState<string | null>(null);
  const [hvscActionLabel, setHvscActionLabel] = useState<string | null>(null);
  const [hvscCurrentFile, setHvscCurrentFile] = useState<string | null>(null);
  const [hvscProcessedCount, setHvscProcessedCount] = useState<number | null>(null);
  const [hvscTotalCount, setHvscTotalCount] = useState<number | null>(null);
  const [hvscDownloadedBytes, setHvscDownloadedBytes] = useState<number | null>(null);
  const [hvscErrorMessage, setHvscErrorMessage] = useState<string | null>(null);
  const [hvscSongsUpserted, setHvscSongsUpserted] = useState<number | null>(null);
  const [hvscSongsDeleted, setHvscSongsDeleted] = useState<number | null>(null);
  const [hvscLastAction, setHvscLastAction] = useState<'update' | 'ingest' | null>(null);
  const [hvscCacheBaseline, setHvscCacheBaseline] = useState<number | null>(null);
  const [hvscCacheUpdates, setHvscCacheUpdates] = useState<number[]>([]);
  const hvscStatsRef = useRef({
    downloadedBytes: null as number | null,
    songsUpserted: null as number | null,
    songsDeleted: null as number | null,
  });
  const hvscLogRef = useRef({
    ingestionId: null as string | null,
    lastStage: null as string | null,
    lastProcessed: 0,
  });
  const [hvscFolderFilter, setHvscFolderFilter] = useState('');
  const [hvscFolders, setHvscFolders] = useState<SongFolder[]>([]);
  const [hvscSongs, setHvscSongs] = useState<SongEntry[]>([]);
  const [selectedHvscFolder, setSelectedHvscFolder] = useState<string>('');
  const [localFiles, setLocalFiles] = useState<LocalSidFile[]>([]);
  const [localFolderFilter, setLocalFolderFilter] = useState('');
  const [selectedLocalFolder, setSelectedLocalFolder] = useState('');
  const [localFolderPaths, setLocalFolderPaths] = useState<SongFolder[]>([]);
  const [localSongs, setLocalSongs] = useState<SongEntry[]>([]);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const selectedLocalFolderRef = useRef('');

  useEffect(() => {
    selectedLocalFolderRef.current = selectedLocalFolder;
  }, [selectedLocalFolder]);

  const handleLocalSongMetadataResolved = useCallback((update: { path: string; entries: SongEntry[] }) => {
    const activeFolder = selectedLocalFolderRef.current;
    if (!activeFolder) return;
    if (!update.path.toLowerCase().startsWith(activeFolder.toLowerCase())) return;
    setLocalSongs((previous) => mergeLocalSongMetadata(previous, update.path, update.entries));
  }, []);

  useEffect(() => {
    getHvscStatus()
      .then(setHvscStatus)
      .catch((error) => {
        addErrorLog('HVSC status fetch failed', { error: (error as Error).message });
        setHvscStatus(null);
      });
  }, []);

  const refreshHvscCacheStatus = useCallback(() => {
    if (!isHvscBridgeAvailable()) return;
    getHvscCacheStatus()
      .then((cache) => {
        setHvscCacheBaseline(cache.baselineVersion ?? null);
        setHvscCacheUpdates(cache.updateVersions ?? []);
      })
      .catch((error) => {
        addErrorLog('HVSC cache status fetch failed', { error: (error as Error).message });
        setHvscCacheBaseline(null);
        setHvscCacheUpdates([]);
      });
  }, []);

  useEffect(() => {
    refreshHvscCacheStatus();
  }, [refreshHvscCacheStatus, hvscStatus?.installedVersion, hvscStatus?.ingestionState]);

  useEffect(() => {
    if (hvscStatus?.ingestionState === 'error' && hvscStatus.ingestionError) {
      setHvscErrorMessage(hvscStatus.ingestionError);
      addErrorLog('HVSC ingestion error', {
        error: hvscStatus.ingestionError,
        installedVersion: hvscStatus.installedVersion,
      });
    }
  }, [hvscStatus?.ingestionError, hvscStatus?.ingestionState, hvscStatus?.installedVersion]);

  useEffect(() => {
    let removeListener: (() => Promise<void>) | null = null;
    addHvscProgressListener((event) => {
      try {
        const logPayload = {
          ingestionId: event.ingestionId,
          stage: event.stage,
          archiveName: event.archiveName,
          currentFile: event.currentFile,
          processedCount: event.processedCount,
          totalCount: event.totalCount,
          elapsedTime: event.elapsedTimeMs,
          errorType: event.errorType,
          errorCause: event.errorCause,
        };

        if (event.ingestionId && event.ingestionId !== hvscLogRef.current.ingestionId) {
          hvscLogRef.current = { ingestionId: event.ingestionId, lastStage: null, lastProcessed: 0 };
          setHvscIngestionId(event.ingestionId);
          setHvscStage(null);
          setHvscProcessedCount(0);
          setHvscTotalCount(null);
          setHvscProgress(0);
          setHvscCurrentFile(null);
          setHvscErrorMessage(null);
          addLog('info', 'HVSC ingestion started', logPayload);
        }

        if (event.stage) {
          setHvscStage(event.stage);
        }
        if (event.message) {
          setHvscActionLabel(event.message);
        }
        if (event.currentFile) {
          setHvscCurrentFile(event.currentFile);
        }
        if (typeof event.processedCount === 'number') {
          setHvscProcessedCount(event.processedCount);
        }
        if (typeof event.totalCount === 'number') {
          setHvscTotalCount(event.totalCount);
        }

        const derivedPercent = calculateHvscProgress(event.processedCount, event.totalCount, event.percent);
        if (derivedPercent !== null) {
          setHvscProgress(derivedPercent);
        }

        if (typeof event.downloadedBytes === 'number') {
          hvscStatsRef.current.downloadedBytes = event.downloadedBytes;
          setHvscDownloadedBytes(event.downloadedBytes);
          if (event.stage === 'download' && event.percent === 100) {
            addLog('info', 'HVSC download complete', {
              ...logPayload,
              bytes: event.downloadedBytes,
              totalBytes: event.totalBytes ?? event.downloadedBytes,
            });
          }
        }
        if (typeof event.songsUpserted === 'number') {
          hvscStatsRef.current.songsUpserted = event.songsUpserted;
          setHvscSongsUpserted(event.songsUpserted);
        }
        if (typeof event.songsDeleted === 'number') {
          hvscStatsRef.current.songsDeleted = event.songsDeleted;
          setHvscSongsDeleted(event.songsDeleted);
        }

        if (event.stage && event.stage !== hvscLogRef.current.lastStage) {
          addLog('info', 'HVSC ingestion stage', logPayload);
          hvscLogRef.current.lastStage = event.stage;
        }

        if (typeof event.processedCount === 'number' && typeof event.totalCount === 'number') {
          if (event.processedCount - hvscLogRef.current.lastProcessed >= HVSC_PROGRESS_LOG_INTERVAL) {
            hvscLogRef.current.lastProcessed = event.processedCount;
            addLog('info', 'HVSC ingestion progress', logPayload);
          }
        }

        if (event.stage === 'error') {
          setHvscErrorMessage(event.errorCause || event.message);
          addErrorLog('HVSC ingestion failed', logPayload);
        }

        if (event.stage === 'complete') {
          addLog('info', 'HVSC ingestion complete', logPayload);
        }
      } catch (error) {
        addErrorLog('HVSC progress handler failed', {
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
      }
    }).then((listener) => {
      removeListener = listener.remove;
    }).catch((error) => {
      addErrorLog('HVSC listener registration failed', {
        error: (error as Error).message,
      });
    });
    return () => {
      if (removeListener) {
        void removeListener();
      }
    };
  }, []);

  const hvscFolderOptions = useMemo(() => {
    if (!hvscFolderFilter) return hvscFolders;
    return hvscFolders.filter((folder) =>
      folder.path.toLowerCase().includes(hvscFolderFilter.toLowerCase()),
    );
  }, [hvscFolders, hvscFolderFilter]);

  const hvscSource = HvscSongSource;
  const hvscInstalled = Boolean(hvscStatus?.installedVersion);
  const hvscUpdating = hvscLoading || ['installing', 'updating'].includes(hvscStatus?.ingestionState ?? '');
  const hvscBridgeAvailable = isHvscBridgeAvailable();
  const hvscHasCache = Boolean(hvscCacheBaseline) || hvscCacheUpdates.length > 0;
  const hvscCanIngest = hvscBridgeAvailable && !hvscInstalled && hvscHasCache && !hvscUpdating;
  const hvscProgressPercent = calculateHvscProgress(hvscProcessedCount, hvscTotalCount, hvscProgress);
  const hvscProgressVisible = Boolean(
    hvscLoading ||
    hvscStage ||
    hvscProcessedCount !== null ||
    hvscTotalCount !== null ||
    hvscProgressPercent !== null,
  );
  const hvscInlineError = hvscErrorMessage ||
    (!hvscLoading && hvscStatus?.ingestionState === 'error' ? hvscStatus.ingestionError : null);

  const localSource = useMemo(
    () =>
      createLocalFsSongSource(localFiles, {
        resolveSonglength: hvscStatus?.installedVersion ? resolveHvscSonglength : undefined,
        onSongMetadataResolved: handleLocalSongMetadataResolved,
      }),
    [handleLocalSongMetadataResolved, localFiles, hvscStatus?.installedVersion],
  );

  const localFolders = useMemo(() => {
    if (!localFolderFilter) return localFolderPaths;
    return localFolderPaths.filter((folder) =>
      folder.path.toLowerCase().includes(localFolderFilter.toLowerCase()),
    );
  }, [localFolderPaths, localFolderFilter]);

  useEffect(() => {
    if (!hvscInstalled) {
      setHvscFolders([]);
      return;
    }
    hvscSource
      .listFolders('/')
      .then(setHvscFolders)
      .catch((error) => {
        addErrorLog('HVSC folder list failed', { error: (error as Error).message });
      });
  }, [hvscInstalled, hvscSource]);

  useEffect(() => {
    if (!selectedHvscFolder || !hvscInstalled) {
      setHvscSongs([]);
      return;
    }
    hvscSource
      .listSongs(selectedHvscFolder)
      .then(setHvscSongs)
      .catch((error) => {
        addErrorLog('HVSC song list failed', { error: (error as Error).message });
      });
  }, [selectedHvscFolder, hvscInstalled, hvscSource]);

  useEffect(() => {
    localSource
      .listFolders('/')
      .then(setLocalFolderPaths)
      .catch((error) => {
        addErrorLog('Local folder list failed', { error: (error as Error).message });
      });
  }, [localSource]);

  useEffect(() => {
    if (!selectedLocalFolder) {
      setLocalSongs([]);
      return;
    }
    localSource
      .listSongs(selectedLocalFolder)
      .then(setLocalSongs)
      .catch((error) => {
        addErrorLog('Local song list failed', { error: (error as Error).message });
      });
  }, [localSource, selectedLocalFolder]);

  const handleHvscUpdate = async () => {
    let currentAction: string | null = null;
    try {
      setHvscLoading(true);
      setHvscProgress(0);
      setHvscStage(null);
      setHvscIngestionId(null);
      setHvscCurrentFile(null);
      setHvscProcessedCount(null);
      setHvscTotalCount(null);
      setHvscErrorMessage(null);
      setHvscLastAction('update');
      hvscStatsRef.current = { downloadedBytes: null, songsUpserted: null, songsDeleted: null };
      setHvscDownloadedBytes(null);
      setHvscSongsUpserted(null);
      setHvscSongsDeleted(null);
      addLog('info', 'HVSC update started', {
        installedVersion: hvscStatus?.installedVersion ?? 0,
        ingestionState: hvscStatus?.ingestionState,
      });
      currentAction = 'Checking for updates…';
      setHvscActionLabel(currentAction);
      const updateStatus: HvscUpdateStatus = await checkForHvscUpdates();
      addLog('info', 'HVSC update check complete', {
        installedVersion: updateStatus.installedVersion,
        latestVersion: updateStatus.latestVersion,
        requiredUpdates: updateStatus.requiredUpdates,
        baselineVersion: updateStatus.baselineVersion,
      });
      if (!updateStatus.requiredUpdates.length && updateStatus.installedVersion > 0) {
        toast({ title: 'HVSC up to date', description: 'No new updates detected.' });
        addLog('info', 'HVSC up to date', { installedVersion: updateStatus.installedVersion });
        const status = await getHvscStatus();
        setHvscStatus(status);
        return;
      }
      currentAction = updateStatus.installedVersion > 0 ? 'Applying updates…' : 'Installing HVSC…';
      setHvscActionLabel(currentAction);
      await installOrUpdateHvsc('hvsc-install');
      const status = await getHvscStatus();
      setHvscStatus(status);
      refreshHvscCacheStatus();
      const stats = hvscStatsRef.current;
      const statsDescription = [
        stats.downloadedBytes !== null ? `Downloaded ${formatBytes(stats.downloadedBytes)}` : null,
        stats.songsUpserted !== null ? `${stats.songsUpserted.toLocaleString()} songs indexed` : null,
        stats.songsDeleted !== null ? `${stats.songsDeleted.toLocaleString()} removed` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      if (statsDescription) {
        addLog('info', 'HVSC update details', {
          downloadedBytes: stats.downloadedBytes,
          songsUpserted: stats.songsUpserted,
          songsDeleted: stats.songsDeleted,
        });
      }
      toast({
        title: 'HVSC ready',
        description: statsDescription
          ? `Version ${status.installedVersion} installed. ${statsDescription}`
          : `Version ${status.installedVersion} installed.`,
      });
    } catch (error) {
      setHvscErrorMessage((error as Error).message);
      reportUserError({
        operation: 'HVSC_DOWNLOAD',
        title: 'Error',
        description: (error as Error).message,
        error,
        context: {
          online: navigator.onLine,
          action: currentAction ?? hvscActionLabel,
          ingestionId: hvscIngestionId,
          stage: hvscStage,
          archiveName: hvscCurrentFile,
        },
      });
    } finally {
      setHvscLoading(false);
      refreshHvscCacheStatus();
    }
  };

  const handleHvscIngest = async () => {
    try {
      setHvscLoading(true);
      setHvscProgress(0);
      setHvscStage(null);
      setHvscIngestionId(null);
      setHvscCurrentFile(null);
      setHvscProcessedCount(null);
      setHvscTotalCount(null);
      setHvscErrorMessage(null);
      setHvscLastAction('ingest');
      setHvscActionLabel('Ingesting cached HVSC…');
      await ingestCachedHvsc('hvsc-ingest');
      const status = await getHvscStatus();
      setHvscStatus(status);
      toast({
        title: 'HVSC ready',
        description: `Version ${status.installedVersion} installed.`,
      });
    } catch (error) {
      setHvscErrorMessage((error as Error).message);
      reportUserError({
        operation: 'HVSC_INGEST',
        title: 'Ingest failed',
        description: (error as Error).message,
        error,
        context: {
          ingestionId: hvscIngestionId,
          stage: hvscStage,
          archiveName: hvscCurrentFile,
        },
      });
    } finally {
      setHvscLoading(false);
      refreshHvscCacheStatus();
    }
  };

  const playFromSource = async (entry: SongEntry, source: SongSource) => {
    const resolved = await source.getSong(entry);
    await playTrack({
      id: entry.id,
      title: entry.title,
      source: source.id,
      path: resolved.path,
      data: resolved.data,
      durationMs: resolved.durationMs,
      songNr: entry.songNr,
      subsongCount: entry.subsongCount,
    });
  };

  const handlePlayHvscTrack = async (entry: SongEntry) => {
    if (!hvscInstalled) return;
    try {
      await playFromSource(entry, hvscSource);
      toast({ title: 'Playing', description: entry.title });
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: { path: entry.path, source: 'hvsc' },
      });
    }
  };

  const handlePlayHvscFolder = async () => {
    if (!hvscInstalled || !hvscSongs.length) return;
    try {
      const tracks = await Promise.all(
        hvscSongs.map(async (entry) => {
          const resolved = await hvscSource.getSong(entry);
          return {
            id: entry.id,
            title: entry.title,
            source: hvscSource.id,
            path: resolved.path,
            data: resolved.data,
            durationMs: resolved.durationMs,
            songNr: entry.songNr,
            subsongCount: entry.subsongCount,
          };
        }),
      );
      const queue = shuffle ? tracks.sort(() => Math.random() - 0.5) : tracks;
      await playQueue(queue);
      toast({
        title: 'Playing folder',
        description: `${queue.length.toLocaleString()} tracks queued`,
      });
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: { folder: selectedHvscFolder, source: 'hvsc' },
      });
    }
  };

  const handleLocalFolderBrowse = async () => {
    try {
      const files = await browseLocalSidFiles(localInputRef.current);
      if (files) {
        setLocalFiles(files);
      }
    } catch (error) {
      reportUserError({
        operation: 'LOCAL_FOLDER_PICK',
        title: 'Folder selection failed',
        description: (error as Error).message,
        error,
      });
    }
  };

  const handleLocalFolderPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const candidates = filterLocalInputFiles(files);
      const ingestion = await ingestLocalArchives(candidates);
      setLocalFiles(ingestion.files);
      if (ingestion.archiveCount > 0) {
        addLog('info', 'Local archives ingested', {
          archives: ingestion.archiveCount,
          extracted: ingestion.extractedCount,
        });
      }
    } catch (error) {
      reportUserError({
        operation: 'LOCAL_ARCHIVE_INGEST',
        title: 'Archive ingest failed',
        description: (error as Error).message,
        error,
      });
    }
  };

  useEffect(() => {
    prepareDirectoryInput(localInputRef.current);
  }, []);

  const handlePlayLocalFolder = async () => {
    if (!localSongs.length) return;
    try {
      const tracks = await Promise.all(
        localSongs.map(async (entry) => {
          const resolved = await localSource.getSong(entry);
          return {
            id: entry.id,
            title: entry.title,
            source: localSource.id,
            path: resolved.path,
            data: resolved.data,
            durationMs: resolved.durationMs,
            songNr: entry.songNr,
            subsongCount: entry.subsongCount,
          };
        }),
      );
      const queue = shuffle ? tracks.sort(() => Math.random() - 0.5) : tracks;
      await playQueue(queue);
      toast({ title: 'Playing folder', description: `${queue.length} tracks queued` });
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: { folder: selectedLocalFolder, source: 'local' },
      });
    }
  };

  const handlePlayRandomLocalFolder = async () => {
    if (!localFolders.length) return;
    const randomFolder = localFolders[Math.floor(Math.random() * localFolders.length)];
    setSelectedLocalFolder(randomFolder.path);

    try {
      const randomSongs = await localSource.listSongs(randomFolder.path);
      if (!randomSongs.length) return;
      const queueTracks = await Promise.all(
        randomSongs.map(async (entry) => {
          const resolved = await localSource.getSong(entry);
          return {
            id: entry.id,
            title: entry.title,
            source: localSource.id,
            path: resolved.path,
            data: resolved.data,
            durationMs: resolved.durationMs,
            songNr: entry.songNr,
            subsongCount: entry.subsongCount,
          };
        }),
      );
      const queue = shuffle ? queueTracks.sort(() => Math.random() - 0.5) : queueTracks;
      await playQueue(queue);
      toast({
        title: 'Playing random folder',
        description: randomFolder.path,
      });
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: { folder: randomFolder.path, source: 'local' },
      });
    }
  };

  const handlePlayLocalTrack = async (entry: SongEntry) => {
    try {
      await playFromSource(entry, localSource);
      toast({ title: 'Playing', description: entry.title });
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: { file: entry.title, source: 'local' },
      });
    }
  };

  const hvscRetryHandler = hvscLastAction === 'ingest' ? handleHvscIngest : handleHvscUpdate;
  const hvscCanRetry = Boolean(hvscInlineError && hvscLastAction && !hvscLoading);

  const progressPercent = durationMs ? Math.min(100, (elapsedMs / durationMs) * 100) : 0;
  const remainingMs = durationMs ? Math.max(0, durationMs - elapsedMs) : undefined;
  const remainingLabel = durationMs ? `-${formatTime(remainingMs)}` : '—';
  const currentSubsongLabel =
    currentTrack?.subsongCount && currentTrack.subsongCount > 1
      ? `Song ${currentTrack.songNr ?? 1}/${currentTrack.subsongCount}`
      : null;
  const nowPlayingPathLabel = currentTrack?.path ?? currentTrack?.source?.toUpperCase() ?? '—';

  const handlePlayCurrentTrack = useCallback(async () => {
    if (!currentTrack) return;
    try {
      await playTrack(currentTrack);
      toast({ title: 'Playing', description: currentTrack.title });
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: { track: currentTrack.title },
      });
    }
  }, [currentTrack, playTrack, reportUserError]);

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Music className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="c64-header text-xl">SID Player</h1>
              <p className="text-xs text-muted-foreground">
                HVSC + local collections with live playback control
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-4 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Now Playing</p>
              <p className="font-medium">
                {currentTrack?.title ?? 'No track selected'}
              </p>
              <p className="text-xs text-muted-foreground">
                {nowPlayingPathLabel}
                {currentSubsongLabel ? ` · ${currentSubsongLabel}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={shuffle}
                onCheckedChange={(checked) => setShuffle(Boolean(checked))}
              />
              <span className="text-xs text-muted-foreground">Shuffle</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="icon" onClick={() => previous()} disabled={!queue.length}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <StatefulButton
              variant={isPlaying ? 'default' : 'outline'}
              size="lg"
              onClick={handlePlayCurrentTrack}
              disabled={!currentTrack}
            >
              <Play className="h-4 w-4 mr-2" />
              {isPlaying ? 'Restart' : 'Play'}
            </StatefulButton>
            <Button variant="outline" size="icon" onClick={() => next()} disabled={!queue.length}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <Progress value={progressPercent} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatTime(elapsedMs)}</span>
              <span>{remainingLabel}</span>
            </div>
          </div>
        </motion.div>

        <Tabs defaultValue="hvsc" className="space-y-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="hvsc">HVSC Library</TabsTrigger>
            <TabsTrigger value="local">Local Library</TabsTrigger>
          </TabsList>

          <TabsContent value="hvsc" className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">HVSC Collection</p>
                  <p className="text-xs text-muted-foreground">
                    {hvscInstalled
                      ? `HVSC v${hvscStatus?.installedVersion ?? '—'} installed`
                      : 'No collection downloaded'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleHvscUpdate}
                    disabled={
                      hvscLoading ||
                      hvscUpdating ||
                      !hvscBridgeAvailable
                    }
                  >
                    {hvscLoading ? 'Updating…' : hvscInstalled ? 'Update' : 'Install'}
                  </Button>
                  {hvscCanIngest && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleHvscIngest}
                      disabled={hvscLoading || hvscUpdating}
                    >
                      Ingest
                    </Button>
                  )}
                </div>
              </div>
              {!hvscBridgeAvailable && (
                <p className="text-xs text-muted-foreground">
                  HVSC updates require the native app build.
                </p>
              )}
              {hvscActionLabel && (
                <p className="text-xs text-muted-foreground">{hvscActionLabel}</p>
              )}
              {hvscProgressVisible && (
                <div className="space-y-1">
                  <Progress value={hvscProgressPercent ?? 0} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {hvscTotalCount !== null
                        ? `SID files: ${(hvscProcessedCount ?? 0).toLocaleString()} / ${hvscTotalCount.toLocaleString()}`
                        : 'Discovering SID files…'}
                    </span>
                    {hvscProgressPercent !== null && (
                      <span>{hvscProgressPercent}%</span>
                    )}
                  </div>
                  {hvscCurrentFile && (
                    <p className="text-[11px] text-muted-foreground break-words whitespace-normal">
                      Current: {hvscCurrentFile}
                    </p>
                  )}
                </div>
              )}
              {hvscStatus?.lastUpdateCheckUtcMs && (
                <p className="text-xs text-muted-foreground">
                  Last checked: {new Date(hvscStatus.lastUpdateCheckUtcMs).toLocaleString()}
                </p>
              )}
              {hvscDownloadedBytes !== null && (
                <p className="text-xs text-muted-foreground">
                  Last download: {formatBytes(hvscDownloadedBytes)}
                </p>
              )}
              {hvscSongsUpserted !== null && (
                <p className="text-xs text-muted-foreground">
                  Songs indexed: {hvscSongsUpserted.toLocaleString()}
                  {hvscSongsDeleted !== null ? ` · Removed ${hvscSongsDeleted.toLocaleString()}` : ''}
                </p>
              )}
              {hvscInlineError && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-destructive">
                    {hvscInlineError}
                  </p>
                  {hvscCanRetry && (
                    <Button variant="outline" size="sm" onClick={hvscRetryHandler}>
                      Retry
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Browse folders</p>
                  <p className="text-xs text-muted-foreground">Play a folder recursively</p>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handlePlayHvscFolder}
                  disabled={!hvscSongs.length || hvscUpdating}
                >
                  Play folder
                </Button>
              </div>

              <Input
                placeholder="Filter folders…"
                value={hvscFolderFilter}
                onChange={(e) => setHvscFolderFilter(e.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {hvscFolderOptions.slice(0, 24).map((folder) => (
                  <Button
                    key={folder.path}
                    variant={folder.path === selectedHvscFolder ? 'secondary' : 'outline'}
                    className="justify-start min-w-0 whitespace-normal items-start"
                    onClick={() => setSelectedHvscFolder(folder.path)}
                  >
                    <Folder className="h-4 w-4 mr-2 shrink-0" />
                    <span className="break-words whitespace-normal">{folder.path}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Tracks</p>
                <p className="text-xs text-muted-foreground">
                  {hvscSongs.length ? `${hvscSongs.length} tracks` : 'Select a folder'}
                </p>
              </div>
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2">
                {hvscSongs.slice(0, 80).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words whitespace-normal">
                        {entry.title}
                      </p>
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">
                        {entry.path}
                        {entry.subsongCount && entry.subsongCount > 1
                          ? ` · Song ${entry.songNr ?? 1}/${entry.subsongCount}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={hvscUpdating}
                      onClick={() => handlePlayHvscTrack(entry)}
                    >
                      Play
                    </Button>
                  </div>
                ))}
                {hvscSongs.length > 80 && (
                  <p className="text-xs text-muted-foreground">
                    Showing first 80 tracks. Use folder filters to narrow the list.
                  </p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="local" className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Local SID folders</p>
                  <p className="text-xs text-muted-foreground">
                    {localFiles.length
                      ? `${localFiles.length} SID files selected`
                      : 'Pick a folder on your device'}
                  </p>
                </div>
                <div className="inline-flex">
                  <input
                    ref={localInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={wrapUserEvent((e) => void handleLocalFolderPick(e.target.files), 'upload', 'MusicPlayer', { type: 'file' }, 'LocalFolderInput')}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLocalFolderBrowse}
                  >
                    <FolderOpen className="h-4 w-4 mr-1" />
                    Pick folder
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Browse folders</p>
                  <p className="text-xs text-muted-foreground">Play a folder recursively</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePlayRandomLocalFolder}
                    disabled={!localFolders.length}
                  >
                    Random folder
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handlePlayLocalFolder}
                    disabled={!localSongs.length}
                  >
                    Play folder
                  </Button>
                </div>
              </div>

              <Input
                placeholder="Filter folders…"
                value={localFolderFilter}
                onChange={(e) => setLocalFolderFilter(e.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {localFolders.slice(0, 24).map((folder) => (
                  <Button
                    key={folder.path}
                    variant={folder.path === selectedLocalFolder ? 'secondary' : 'outline'}
                    className="justify-start min-w-0 whitespace-normal items-start"
                    onClick={() => setSelectedLocalFolder(folder.path)}
                  >
                    <Folder className="h-4 w-4 mr-2 shrink-0" />
                    <span className="break-words whitespace-normal">{folder.path}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Tracks</p>
                <p className="text-xs text-muted-foreground">
                  {localSongs.length ? `${localSongs.length} tracks` : 'Select a folder'}
                </p>
              </div>
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2">
                {localSongs.slice(0, 80).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words whitespace-normal">
                        {entry.title}
                      </p>
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">
                        {entry.path}
                        {entry.subsongCount && entry.subsongCount > 1
                          ? ` · Song ${entry.songNr ?? 1}/${entry.subsongCount}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePlayLocalTrack(entry)}
                    >
                      Play
                    </Button>
                  </div>
                ))}
                {localSongs.length > 80 && (
                  <p className="text-xs text-muted-foreground">
                    Showing first 80 tracks. Use folder filters to narrow the list.
                  </p>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

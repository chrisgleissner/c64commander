import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music, Shuffle, SkipBack, SkipForward, Play, Folder, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSidPlayer } from '@/hooks/useSidPlayer';
import { toast } from '@/hooks/use-toast';
import { addErrorLog, addLog } from '@/lib/logging';
import {
  addHvscProgressListener,
  checkForHvscUpdates,
  getHvscCacheStatus,
  getHvscDurationByMd5Seconds,
  getHvscStatus,
  ingestCachedHvsc,
  installOrUpdateHvsc,
  isHvscBridgeAvailable,
  type HvscStatus,
  type HvscUpdateStatus,
  HvscSongSource,
} from '@/lib/hvsc';
import { createLocalFsSongSource, type LocalSidFile } from '@/lib/sources/LocalFsSongSource';
import { browseLocalSidFiles, filterSidFiles, prepareDirectoryInput } from '@/lib/sources/localFsPicker';
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
  const [hvscActionLabel, setHvscActionLabel] = useState<string | null>(null);
  const [hvscDownloadedBytes, setHvscDownloadedBytes] = useState<number | null>(null);
  const [hvscSongsUpserted, setHvscSongsUpserted] = useState<number | null>(null);
  const [hvscSongsDeleted, setHvscSongsDeleted] = useState<number | null>(null);
  const [hvscCacheBaseline, setHvscCacheBaseline] = useState<number | null>(null);
  const [hvscCacheUpdates, setHvscCacheUpdates] = useState<number[]>([]);
  const hvscStatsRef = useRef({
    downloadedBytes: null as number | null,
    songsUpserted: null as number | null,
    songsDeleted: null as number | null,
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
      addErrorLog('HVSC ingestion error', {
        error: hvscStatus.ingestionError,
        installedVersion: hvscStatus.installedVersion,
      });
    }
  }, [hvscStatus?.ingestionError, hvscStatus?.ingestionState, hvscStatus?.installedVersion]);

  useEffect(() => {
    let removeListener: (() => Promise<void>) | null = null;
    addHvscProgressListener((event) => {
      if (event.message) {
        setHvscActionLabel(event.message);
      }
      if (typeof event.percent === 'number') {
        setHvscProgress(event.percent);
      } else {
        setHvscProgress(null);
      }
      if (typeof event.downloadedBytes === 'number') {
        hvscStatsRef.current.downloadedBytes = event.downloadedBytes;
        setHvscDownloadedBytes(event.downloadedBytes);
        addLog('info', 'HVSC download complete', {
          bytes: event.downloadedBytes,
          totalBytes: event.totalBytes ?? event.downloadedBytes,
          message: event.message,
        });
      }
      if (typeof event.songsUpserted === 'number') {
        hvscStatsRef.current.songsUpserted = event.songsUpserted;
        setHvscSongsUpserted(event.songsUpserted);
      }
      if (typeof event.songsDeleted === 'number') {
        hvscStatsRef.current.songsDeleted = event.songsDeleted;
        setHvscSongsDeleted(event.songsDeleted);
      }
      if (event.phase === 'summary') {
        addLog('info', 'HVSC ingestion summary', {
          message: event.message,
          songsUpserted: event.songsUpserted,
          songsDeleted: event.songsDeleted,
        });
      }
    }).then((listener) => {
      removeListener = listener.remove;
    }).catch(() => {
      // ignore listener failures on web
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

  const localSource = useMemo(
    () =>
      createLocalFsSongSource(localFiles, {
        lookupDurationSeconds: hvscStatus?.installedVersion ? getHvscDurationByMd5Seconds : undefined,
      }),
    [localFiles, hvscStatus?.installedVersion],
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
      addErrorLog('HVSC update failed', {
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
        online: navigator.onLine,
        action: currentAction ?? hvscActionLabel,
      });
      toast({
        title: 'Error',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setHvscLoading(false);
      setHvscProgress(null);
      setHvscActionLabel(null);
      refreshHvscCacheStatus();
    }
  };

  const handleHvscIngest = async () => {
    try {
      setHvscLoading(true);
      setHvscProgress(0);
      setHvscActionLabel('Ingesting cached HVSC…');
      await ingestCachedHvsc('hvsc-ingest');
      const status = await getHvscStatus();
      setHvscStatus(status);
      toast({
        title: 'HVSC ready',
        description: `Version ${status.installedVersion} installed.`,
      });
    } catch (error) {
      addErrorLog('HVSC cached ingest failed', { error: (error as Error).message });
      toast({
        title: 'Ingest failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setHvscLoading(false);
      setHvscProgress(null);
      setHvscActionLabel(null);
      refreshHvscCacheStatus();
    }
  };

  const playFromSource = async (entry: SongEntry, source: SongSource) => {
    const resolved = await source.getSong(entry);
    await playTrack({
      id: entry.id,
      title: resolved.title,
      source: source.id,
      path: resolved.path,
      data: resolved.data,
      durationMs: resolved.durationMs,
    });
  };

  const handlePlayHvscTrack = async (entry: SongEntry) => {
    if (!hvscInstalled) return;
    try {
      await playFromSource(entry, hvscSource);
      toast({ title: 'Playing', description: entry.title });
    } catch (error) {
      addErrorLog('HVSC track playback failed', { path: entry.path, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
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
            title: resolved.title,
            source: hvscSource.id,
            path: resolved.path,
            data: resolved.data,
            durationMs: resolved.durationMs,
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
      addErrorLog('HVSC folder playback failed', { folder: selectedHvscFolder, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
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
      addErrorLog('Local folder pick failed', {
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
      });
      toast({
        title: 'Folder selection failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleLocalFolderPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = filterSidFiles(files);
    setLocalFiles(list);
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
            title: resolved.title,
            source: localSource.id,
            path: resolved.path,
            data: resolved.data,
            durationMs: resolved.durationMs,
          };
        }),
      );
      const queue = shuffle ? tracks.sort(() => Math.random() - 0.5) : tracks;
      await playQueue(queue);
      toast({ title: 'Playing folder', description: `${queue.length} tracks queued` });
    } catch (error) {
      addErrorLog('Local folder playback failed', { folder: selectedLocalFolder, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
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
            title: resolved.title,
            source: localSource.id,
            path: resolved.path,
            data: resolved.data,
            durationMs: resolved.durationMs,
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
      addErrorLog('Random local folder playback failed', { folder: randomFolder.path, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handlePlayLocalTrack = async (entry: SongEntry) => {
    try {
      await playFromSource(entry, localSource);
      toast({ title: 'Playing', description: entry.title });
    } catch (error) {
      addErrorLog('Local track playback failed', { file: entry.title, error: (error as Error).message });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const progressPercent = durationMs ? Math.min(100, (elapsedMs / durationMs) * 100) : 0;

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
                {currentTrack?.path ?? currentTrack?.source?.toUpperCase() ?? '—'}
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

          <div className="space-y-2">
            <Progress value={progressPercent} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatTime(elapsedMs)}</span>
              <span>{formatTime(durationMs)}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="icon" onClick={() => previous()} disabled={!queue.length}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="default"
              size="lg"
              onClick={() => currentTrack && playTrack(currentTrack)}
              disabled={!currentTrack}
            >
              <Play className="h-4 w-4 mr-2" />
              {isPlaying ? 'Restart' : 'Play'}
            </Button>
            <Button variant="outline" size="icon" onClick={() => next()} disabled={!queue.length}>
              <SkipForward className="h-4 w-4" />
            </Button>
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
              {hvscProgress !== null && (
                <Progress value={hvscProgress} />
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
              {hvscStatus?.ingestionState === 'error' && hvscStatus.ingestionError && (
                <p className="text-xs text-destructive">
                  {hvscStatus.ingestionError}
                </p>
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
                    className="justify-start"
                    onClick={() => setSelectedHvscFolder(folder.path)}
                  >
                    <Folder className="h-4 w-4 mr-2" />
                    {folder.path}
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
                    <div className="text-xs text-muted-foreground truncate">
                      {entry.path}
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
                    onChange={(e) => handleLocalFolderPick(e.target.files)}
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
                    className="justify-start"
                    onClick={() => setSelectedLocalFolder(folder.path)}
                  >
                    <Folder className="h-4 w-4 mr-2" />
                    {folder.path}
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
                    <div className="text-xs text-muted-foreground truncate">
                      {entry.path}
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

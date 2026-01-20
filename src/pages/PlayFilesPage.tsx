import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUp, FolderOpen, Play, RefreshCw, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useC64Connection } from '@/hooks/useC64Connection';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { getC64API, C64_DEFAULTS } from '@/lib/c64api';
import { listFtpDirectory } from '@/lib/ftp/ftpClient';
import { getStoredFtpPort } from '@/lib/ftp/ftpConfig';
import { browseLocalPlayFiles, filterPlayInputFiles, prepareDirectoryInput } from '@/lib/playback/localFilePicker';
import { getParentPath, listLocalFiles, listLocalFolders } from '@/lib/playback/localFileBrowser';
import { buildPlayPlan, executePlayPlan, type PlaySource, type PlayRequest, type LocalPlayFile } from '@/lib/playback/playbackRouter';
import { formatPlayCategory, getPlayCategory, isSupportedPlayFile, type PlayFileCategory } from '@/lib/playback/fileTypes';
import { base64ToUint8, computeSidMd5 } from '@/lib/sid/sidUtils';
import {
  addHvscProgressListener,
  checkForHvscUpdates,
  getHvscDurationByMd5Seconds,
  getHvscFolderListing,
  getHvscSong,
  getHvscStatus,
  ingestCachedHvsc,
  installOrUpdateHvsc,
  isHvscBridgeAvailable,
  type HvscStatus,
} from '@/lib/hvsc';

const useInitialSource = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const sourceParam = params.get('source');
  if (sourceParam === 'ultimate' || sourceParam === 'local') return sourceParam;
  return 'local' as PlaySource;
};

type BrowserEntry = {
  source: PlaySource;
  type: 'file' | 'dir';
  name: string;
  path: string;
  file?: LocalPlayFile;
  durationMs?: number;
};

type PlaylistItem = {
  id: string;
  request: PlayRequest;
  category: PlayFileCategory;
  label: string;
  path: string;
  durationMs?: number;
  subsongCount?: number;
};

const CATEGORY_OPTIONS: PlayFileCategory[] = ['sid', 'mod', 'prg', 'crt', 'disk', 'volume'];

const formatTime = (ms?: number) => {
  if (ms === undefined) return '—';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

const getLocalFilePath = (file: LocalPlayFile) => {
  const candidate =
    (file as File).webkitRelativePath || (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return normalizeLocalPath(candidate);
};

const parseDurationInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(':')) {
    const [minutesRaw, secondsRaw] = trimmed.split(':');
    const minutes = Number(minutesRaw);
    const seconds = Number(secondsRaw);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) return undefined;
    return Math.max(0, (minutes * 60 + seconds) * 1000);
  }
  const seconds = Number(trimmed);
  if (Number.isNaN(seconds)) return undefined;
  return Math.max(0, seconds * 1000);
};

const getSidSongCount = (buffer: ArrayBuffer) => {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 18) return 1;
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );
    if (magic !== 'PSID' && magic !== 'RSID') return 1;
    const songs = view.getUint16(14, false);
    return songs > 0 ? songs : 1;
  } catch {
    return 1;
  }
};

export default function PlayFilesPage() {
  const navigate = useNavigate();
  const { status } = useC64Connection();
  const initialSource = useInitialSource();

  const [source, setSource] = useState<PlaySource>(initialSource);
  const [localFiles, setLocalFiles] = useState<LocalPlayFile[]>([]);
  const [localPath, setLocalPath] = useState('/');
  const [remotePath, setRemotePath] = useState('/');
  const [remoteEntries, setRemoteEntries] = useState<Array<{ name: string; path: string; type: 'file' | 'dir' }>>([]);
  const [isRemoteLoading, setIsRemoteLoading] = useState(false);
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [remoteInitialized, setRemoteInitialized] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playlistElapsedMs, setPlaylistElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [durationInput, setDurationInput] = useState('');
  const [songNrInput, setSongNrInput] = useState('');
  const [recurseFolders, setRecurseFolders] = useState(true);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [shuffleCategories, setShuffleCategories] = useState<PlayFileCategory[]>(CATEGORY_OPTIONS);
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [durationPickerOpen, setDurationPickerOpen] = useState(false);

  const { flags, isLoaded } = useFeatureFlags();
  const [hvscFlagStorage, setHvscFlagStorage] = useState(false);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const localFlag = localStorage.getItem('c64u_feature_flag:hvsc_enabled') === '1';
    const sessionFlag = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('c64u_feature_flag:hvsc_enabled') === '1'
      : false;
    setHvscFlagStorage(localFlag || sessionFlag);
  }, [flags.hvsc_enabled, isLoaded]);
  const hvscControlsEnabled = flags.hvsc_enabled || hvscFlagStorage;

  const [hvscStatus, setHvscStatus] = useState<HvscStatus | null>(null);
  const [hvscLoading, setHvscLoading] = useState(false);
  const [hvscProgress, setHvscProgress] = useState<number | null>(null);
  const [hvscStage, setHvscStage] = useState<string | null>(null);
  const [hvscActionLabel, setHvscActionLabel] = useState<string | null>(null);
  const [hvscCurrentFile, setHvscCurrentFile] = useState<string | null>(null);
  const [hvscErrorMessage, setHvscErrorMessage] = useState<string | null>(null);
  const [hvscFolderFilter, setHvscFolderFilter] = useState('');
  const [hvscFolders, setHvscFolders] = useState<string[]>([]);
  const [hvscSongs, setHvscSongs] = useState<Array<{ id: number; virtualPath: string; fileName: string; durationSeconds?: number | null }>>([]);
  const [selectedHvscFolder, setSelectedHvscFolder] = useState('/');

  const localFolderInputRef = useRef<HTMLInputElement | null>(null);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const playlistStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    prepareDirectoryInput(localFolderInputRef.current);
  }, []);

  const handleLocalBrowse = async () => {
    setIsLocalLoading(true);
    try {
      const files = await browseLocalPlayFiles(localFolderInputRef.current);
      if (files && files.length > 0) {
        setLocalFiles(files);
        setLocalPath('/');
        return;
      }
      if (files) {
        toast({
          title: 'No supported files',
          description: 'Found no supported files.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      addErrorLog('Local file browsing failed', { error: (error as Error).message });
      toast({
        title: 'Local browse failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsLocalLoading(false);
    }
  };

  const handleLocalFolderInput = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const filtered = filterPlayInputFiles(files);
    if (!filtered.length) {
      toast({
        title: 'No supported files',
        description: 'Found no supported files.',
        variant: 'destructive',
      });
      return;
    }
    setLocalFiles(filtered);
    setLocalPath('/');
  };

  const loadRemoteEntries = async (path: string) => {
    setIsRemoteLoading(true);
    try {
      const deviceHost = localStorage.getItem('c64u_device_host') || C64_DEFAULTS.DEFAULT_DEVICE_HOST;
      const password = localStorage.getItem('c64u_password') || '';
      const result = await listFtpDirectory({ host: deviceHost, port: getStoredFtpPort(), password, path });
      setRemoteEntries(result.entries);
      setRemotePath(result.path);
      setRemoteInitialized(true);
    } catch (error) {
      toast({
        title: 'FTP browse failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsRemoteLoading(false);
    }
  };

  useEffect(() => {
    if (source === 'ultimate' && !remoteInitialized) {
      void loadRemoteEntries(remotePath);
    }
  }, [source, remoteInitialized, remotePath]);

  const refreshHvscStatus = useCallback(() => {
    if (!isHvscBridgeAvailable()) return;
    getHvscStatus()
      .then(setHvscStatus)
      .catch((error) => {
        addErrorLog('HVSC status fetch failed', { error: (error as Error).message });
        setHvscStatus(null);
      });
  }, []);

  useEffect(() => {
    refreshHvscStatus();
  }, [refreshHvscStatus]);

  useEffect(() => {
    if (!isHvscBridgeAvailable()) return;
    let removeListener: (() => Promise<void>) | null = null;
    addHvscProgressListener((event) => {
      if (event.message) setHvscActionLabel(event.message);
      if (event.stage) setHvscStage(event.stage);
      if (typeof event.percent === 'number') setHvscProgress(event.percent);
      if (event.currentFile) setHvscCurrentFile(event.currentFile);
      if (event.errorCause) setHvscErrorMessage(event.errorCause);
    }).then((handler) => {
      removeListener = handler.remove;
    });
    return () => {
      if (removeListener) void removeListener();
    };
  }, []);

  const loadHvscFolder = useCallback(async (path: string) => {
    try {
      const listing = await getHvscFolderListing(path);
      setHvscFolders(listing.folders);
      setHvscSongs(listing.songs);
      setSelectedHvscFolder(listing.path);
    } catch (error) {
      addErrorLog('HVSC folder listing failed', { path, error: (error as Error).message });
      toast({
        title: 'HVSC browse failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, []);

  useEffect(() => {
    if (!hvscStatus?.installedVersion) return;
    if (hvscFolders.length || hvscSongs.length) return;
    void loadHvscFolder(selectedHvscFolder || '/');
  }, [hvscStatus?.installedVersion, hvscFolders.length, hvscSongs.length, loadHvscFolder, selectedHvscFolder]);

  useEffect(() => {
    if (!isPlaying || currentIndex < 0) return;
    const tick = () => {
      if (trackStartedAtRef.current) {
        setElapsedMs(Date.now() - trackStartedAtRef.current);
      }
      if (playlistStartedAtRef.current) {
        setPlaylistElapsedMs(Date.now() - playlistStartedAtRef.current);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [currentIndex, isPlaying]);

  const currentItem = playlist[currentIndex];
  const subsongCount = currentItem?.subsongCount ?? 1;
  const songNrValue = Number(songNrInput);
  const resolvedSongNr = Number.isNaN(songNrValue) || songNrInput.trim() === '' ? 1 : songNrValue;
  const clampedSongNr = Math.min(Math.max(1, resolvedSongNr), subsongCount);
  const canEditSongNr = currentItem?.category === 'sid' && subsongCount > 1;
  const sidControlsEnabled = currentItem?.category === 'sid';
  const durationOverrideValue = parseDurationInput(durationInput);
  const durationLabel = durationOverrideValue !== undefined ? formatTime(durationOverrideValue) : 'Auto';

  const toggleShuffleCategory = (category: PlayFileCategory) => {
    setShuffleCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category],
    );
  };

  const shouldIncludeCategory = useCallback(
    (path: string) => {
      const category = getPlayCategory(path);
      if (!category) return false;
      if (!shuffleEnabled) return true;
      return shuffleCategories.includes(category);
    },
    [shuffleEnabled, shuffleCategories],
  );

  const resolveSidMetadata = useCallback(async (file?: LocalPlayFile) => {
    if (!file) return { durationMs: undefined, subsongCount: undefined } as const;
    const override = parseDurationInput(durationInput);
    try {
      const buffer = await file.arrayBuffer();
      const subsongCount = getSidSongCount(buffer);
      if (override !== undefined) {
        return { durationMs: override, subsongCount } as const;
      }
      const md5 = await computeSidMd5(buffer);
      const seconds = await getHvscDurationByMd5Seconds(md5);
      return { durationMs: seconds ? seconds * 1000 : undefined, subsongCount } as const;
    } catch {
      return { durationMs: override, subsongCount: undefined } as const;
    }
  }, [durationInput]);

  const buildPlaylistItem = useCallback((entry: BrowserEntry): PlaylistItem | null => {
    const category = getPlayCategory(entry.path);
    if (!category) return null;
    const songNrValue = songNrInput.trim() === '' ? undefined : Math.max(1, Number(songNrInput));
    const request: PlayRequest = {
      source: entry.source,
      path: entry.path,
      file: entry.file,
      songNr: Number.isNaN(songNrValue) ? undefined : songNrValue,
    };
    return {
      id: `${entry.source}:${entry.path}`,
      request,
      category,
      label: entry.name,
      path: entry.path,
      durationMs: entry.durationMs,
    };
  }, [songNrInput]);

  const playItem = useCallback(async (item: PlaylistItem) => {
    const api = getC64API();
    let durationOverride: number | undefined;
    let subsongCount: number | undefined;
    if (item.category === 'sid' && item.request.source === 'local') {
      const metadata = await resolveSidMetadata(item.request.file);
      durationOverride = metadata.durationMs;
      subsongCount = metadata.subsongCount;
    }
    const request: PlayRequest = durationOverride
      ? { ...item.request, durationMs: durationOverride }
      : item.request;
    const plan = buildPlayPlan(request);
    await executePlayPlan(api, plan);
    trackStartedAtRef.current = Date.now();
    setElapsedMs(0);
    const resolvedDuration = durationOverride ?? item.durationMs;
    setDurationMs(resolvedDuration);
    if (resolvedDuration !== item.durationMs || subsongCount !== item.subsongCount) {
      setPlaylist((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, durationMs: resolvedDuration, subsongCount: subsongCount ?? entry.subsongCount }
            : entry,
        ),
      );
    }
    setIsPlaying(true);
  }, [resolveSidMetadata]);

  const startPlaylist = useCallback(async (items: PlaylistItem[], startIndex = 0) => {
    if (!items.length) return;
    setPlaylist(items);
    setCurrentIndex(startIndex);
    playlistStartedAtRef.current = Date.now();
    setPlaylistElapsedMs(0);
    setIsPlaylistLoading(true);
    try {
      await playItem(items[startIndex]);
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [playItem]);

  const handleNext = useCallback(async () => {
    if (!playlist.length) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      setIsPlaying(false);
      return;
    }
    setCurrentIndex(nextIndex);
    await playItem(playlist[nextIndex]);
  }, [currentIndex, playItem, playlist]);

  const handlePrevious = useCallback(async () => {
    if (!playlist.length) return;
    const prevIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(prevIndex);
    await playItem(playlist[prevIndex]);
  }, [currentIndex, playItem, playlist]);

  useEffect(() => {
    if (!isPlaying || durationMs === undefined) return;
    if (elapsedMs >= durationMs) {
      void handleNext();
    }
  }, [elapsedMs, durationMs, handleNext, isPlaying]);

  const handleReshuffle = useCallback(() => {
    if (!shuffleEnabled || !playlist.length || currentIndex < 0) return;
    setPlaylist((prev) => {
      if (prev.length < 2) return prev;
      const head = prev.slice(0, currentIndex + 1);
      const tail = prev.slice(currentIndex + 1);
      const shuffled = [...tail].sort(() => Math.random() - 0.5);
      return [...head, ...shuffled];
    });
  }, [currentIndex, playlist.length, shuffleEnabled]);

  const handlePlayEntry = useCallback(async (entry: BrowserEntry) => {
    try {
      const item = buildPlaylistItem(entry);
      if (!item) throw new Error('Unsupported file format.');
      await startPlaylist([item]);
      toast({
        title: 'Playback started',
        description: `${formatPlayCategory(item.category)} added to playlist`,
      });
    } catch (error) {
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [buildPlaylistItem, startPlaylist]);

  const collectLocalFiles = useCallback((rootPath: string) => {
    const normalized = normalizeLocalPath(rootPath || '/');
    return localFiles
      .map((file) => ({ file, path: getLocalFilePath(file) }))
      .filter((entry) => entry.path.startsWith(normalized))
      .filter((entry) => {
        if (!recurseFolders) {
          const suffix = entry.path.slice(normalized.length);
          if (suffix.includes('/')) return false;
        }
        return isSupportedPlayFile(entry.path) && shouldIncludeCategory(entry.path);
      });
  }, [localFiles, recurseFolders, shouldIncludeCategory]);

  const collectRemoteFiles = useCallback(async (rootPath: string) => {
    const deviceHost = localStorage.getItem('c64u_device_host') || C64_DEFAULTS.DEFAULT_DEVICE_HOST;
    const password = localStorage.getItem('c64u_password') || '';
    const queuePaths = [rootPath || '/'];
    const results: Array<{ path: string; name: string }> = [];
    const visited = new Set<string>();
    while (queuePaths.length) {
      const currentPath = queuePaths.shift();
      if (!currentPath || visited.has(currentPath)) continue;
      visited.add(currentPath);
      const listing = await listFtpDirectory({ host: deviceHost, port: getStoredFtpPort(), password, path: currentPath });
      for (const entry of listing.entries) {
        if (entry.type === 'dir') {
          if (recurseFolders) {
            queuePaths.push(entry.path);
          }
          continue;
        }
        if (!isSupportedPlayFile(entry.name) || !shouldIncludeCategory(entry.path)) continue;
        results.push({ path: entry.path, name: entry.name });
      }
    }
    return results;
  }, [recurseFolders, shouldIncludeCategory]);

  const handleHvscInstall = useCallback(async () => {
    try {
      setHvscLoading(true);
      setHvscProgress(0);
      setHvscStage(null);
      setHvscErrorMessage(null);
      setHvscActionLabel('Checking for updates…');
      const updateStatus = await checkForHvscUpdates();
      if (!updateStatus.requiredUpdates.length && updateStatus.installedVersion > 0) {
        toast({ title: 'HVSC up to date', description: 'No new updates detected.' });
        refreshHvscStatus();
        return;
      }
      setHvscActionLabel(updateStatus.installedVersion ? 'Applying updates…' : 'Installing HVSC…');
      await installOrUpdateHvsc('hvsc-install');
      const status = await getHvscStatus();
      setHvscStatus(status);
      toast({
        title: 'HVSC ready',
        description: `Version ${status.installedVersion} installed.`,
      });
    } catch (error) {
      setHvscErrorMessage((error as Error).message);
      toast({
        title: 'HVSC update failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setHvscLoading(false);
    }
  }, [refreshHvscStatus]);

  const handleHvscIngest = useCallback(async () => {
    try {
      setHvscLoading(true);
      setHvscProgress(0);
      setHvscStage(null);
      setHvscErrorMessage(null);
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
      toast({
        title: 'HVSC ingest failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setHvscLoading(false);
    }
  }, []);

  const buildHvscFile = useCallback((song: { id: number; virtualPath: string; fileName: string }) => {
    const name = song.fileName;
    return {
      name,
      webkitRelativePath: song.virtualPath,
      lastModified: Date.now(),
      arrayBuffer: async () => {
        const detail = await getHvscSong({ id: song.id });
        const data = base64ToUint8(detail.dataBase64);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
    } as LocalPlayFile;
  }, []);

  const collectHvscSongs = useCallback(async (rootPath: string) => {
    const queuePaths = [rootPath || '/'];
    const results: Array<{ id: number; virtualPath: string; fileName: string; durationSeconds?: number | null }> = [];
    const visited = new Set<string>();
    while (queuePaths.length) {
      const currentPath = queuePaths.shift();
      if (!currentPath || visited.has(currentPath)) continue;
      visited.add(currentPath);
      const listing = await getHvscFolderListing(currentPath);
      listing.songs.forEach((song) => {
        results.push(song);
      });
      if (recurseFolders) {
        listing.folders.forEach((folder) => queuePaths.push(folder));
      }
    }
    return results;
  }, [recurseFolders]);

  const handlePlayFolder = useCallback(async (targetSource: PlaySource, targetPath: string) => {
    try {
      if (targetSource === 'local') {
        const files = collectLocalFiles(targetPath);
        if (!files.length) {
          toast({
            title: 'No playable files',
            description: 'No supported files in this folder.',
            variant: 'destructive',
          });
          return;
        }
        const entries = files.map((entry) => ({
          source: 'local' as PlaySource,
          type: 'file' as const,
          name: entry.path.split('/').pop() || entry.path,
          path: entry.path,
          file: entry.file,
        }));
        const items = entries
          .map(buildPlaylistItem)
          .filter((item): item is PlaylistItem => Boolean(item));
        if (!items.length) return;
        const queueItems = shuffleEnabled ? [...items].sort(() => Math.random() - 0.5) : items;
        await startPlaylist(queueItems);
        toast({
          title: 'Playback started',
          description: `${queueItems.length} files added to playlist`,
        });
        return;
      }

      if (!status.isConnected) {
        toast({
          title: 'Device offline',
          description: 'Connect to your Ultimate 64 to play files.',
          variant: 'destructive',
        });
        return;
      }

      const files = await collectRemoteFiles(targetPath);
      if (!files.length) {
        toast({
          title: 'No playable files',
          description: 'No supported files in this folder.',
          variant: 'destructive',
        });
        return;
      }
      const entries = files.map((entry) => ({
        source: 'ultimate' as PlaySource,
        type: 'file' as const,
        name: entry.name,
        path: entry.path,
      }));
      const items = entries
        .map(buildPlaylistItem)
        .filter((item): item is PlaylistItem => Boolean(item));
      if (!items.length) return;
      const queueItems = shuffleEnabled ? [...items].sort(() => Math.random() - 0.5) : items;
      await startPlaylist(queueItems);
      toast({
        title: 'Playback started',
        description: `${queueItems.length} files added to playlist`,
      });
    } catch (error) {
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [buildPlaylistItem, collectLocalFiles, collectRemoteFiles, shuffleEnabled, startPlaylist, status.isConnected]);

  const handlePlayHvscFolder = useCallback(async (path: string) => {
    try {
      if (!hvscStatus?.installedVersion) {
        toast({
          title: 'HVSC unavailable',
          description: 'Install HVSC to play the collection.',
          variant: 'destructive',
        });
        return;
      }
      const songs = await collectHvscSongs(path);
      if (!songs.length) {
        toast({
          title: 'No HVSC songs',
          description: 'No SID files found in this folder.',
          variant: 'destructive',
        });
        return;
      }
      const entries: BrowserEntry[] = songs.map((song) => ({
        source: 'local',
        type: 'file',
        name: song.fileName,
        path: song.virtualPath,
        file: buildHvscFile(song),
        durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
      }));
      const items = entries
        .map(buildPlaylistItem)
        .filter((item): item is PlaylistItem => Boolean(item));
      if (!items.length) return;
      const playlistItems = shuffleEnabled ? [...items].sort(() => Math.random() - 0.5) : items;
      await startPlaylist(playlistItems);
      toast({
        title: 'Playback started',
        description: `${playlistItems.length} files added to playlist`,
      });
    } catch (error) {
      toast({
        title: 'HVSC playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [buildHvscFile, buildPlaylistItem, collectHvscSongs, hvscStatus?.installedVersion, shuffleEnabled, startPlaylist]);

  const remoteVisibleEntries = useMemo(
    () =>
      remoteEntries
        .filter((entry) => entry.type === 'dir' || isSupportedPlayFile(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [remoteEntries],
  );

  const localEntries = useMemo<BrowserEntry[]>(() => {
    const folders = listLocalFolders(localFiles, localPath).map((folder) => ({
      source: 'local' as PlaySource,
      type: 'dir' as const,
      name: folder.replace(localPath, '').replace(/\/$/, '') || folder,
      path: folder,
    }));
    const files = listLocalFiles(localFiles, localPath).map((entry) => ({
      source: 'local' as PlaySource,
      type: 'file' as const,
      name: entry.name,
      path: entry.path,
      file: entry.file,
    }));
    return [...folders, ...files].sort((a, b) => a.name.localeCompare(b.name));
  }, [localFiles, localPath]);

  const remoteEntriesView = useMemo<BrowserEntry[]>(
    () =>
      remoteVisibleEntries.map((entry) => ({
        source: 'ultimate' as PlaySource,
        type: entry.type,
        name: entry.name,
        path: entry.path,
      })),
    [remoteVisibleEntries],
  );

  const playlistItemDuration = useCallback(
    (item: PlaylistItem, index: number) => (index === currentIndex ? durationMs ?? item.durationMs : item.durationMs),
    [currentIndex, durationMs],
  );

  const playlistTotals = useMemo(() => {
    if (!playlist.length) return { total: undefined, remaining: undefined } as const;
    const durations = playlist.map((item, index) => playlistItemDuration(item, index));
    const allKnown = durations.every((value) => value !== undefined);
    if (!allKnown) return { total: undefined, remaining: undefined } as const;
    const total = durations.reduce((sum, value) => sum + (value ?? 0), 0);
    if (currentIndex < 0) return { total, remaining: total } as const;
    const currentDuration = durations[currentIndex] ?? 0;
    const future = durations.slice(currentIndex + 1).reduce((sum, value) => sum + (value ?? 0), 0);
    const remaining = Math.max(0, currentDuration - elapsedMs) + future;
    return { total, remaining } as const;
  }, [currentIndex, elapsedMs, playlist, playlistItemDuration]);

  const playlistPreview = useMemo(() => {
    if (!playlist.length) return [] as Array<{ item: PlaylistItem; index: number }>;
    const start = Math.max(0, currentIndex - 1);
    const end = Math.min(playlist.length, currentIndex + 3);
    return playlist.slice(start, end).map((item, offset) => ({ item, index: start + offset }));
  }, [currentIndex, playlist]);

  const hvscInstalled = Boolean(hvscStatus?.installedVersion);
  const hvscAvailable = isHvscBridgeAvailable();
  const hvscUpdating = hvscLoading || hvscStatus?.ingestionState === 'installing' || hvscStatus?.ingestionState === 'updating';
  const hvscInlineError = hvscErrorMessage || (hvscStatus?.ingestionState === 'error' ? hvscStatus.ingestionError : null);

  const hvscVisibleFolders = useMemo(() => {
    if (!hvscFolderFilter) return hvscFolders;
    return hvscFolders.filter((folder) => folder.toLowerCase().includes(hvscFolderFilter.toLowerCase()));
  }, [hvscFolders, hvscFolderFilter]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      <main className="container max-w-3xl mx-auto px-4 py-6 pb-24 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}
              aria-label="Back to home">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-xl font-semibold">Play Files</h2>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${status.isConnected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
            {status.isConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border p-1 bg-muted/30">
          <Button
            variant={source === 'local' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSource('local')}
          >
            Browse local device
          </Button>
          <Button
            variant={source === 'ultimate' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSource('ultimate')}
          >
            Browse Ultimate 64
          </Button>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Playback controls</p>
              <p className="text-xs text-muted-foreground">
                {currentItem ? currentItem.label : 'Select a file or folder to start'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void handlePrevious()} disabled={!playlist.length || isPlaylistLoading}>
                <SkipBack className="h-4 w-4 mr-1" />
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleNext()} disabled={!playlist.length || isPlaylistLoading}>
                <SkipForward className="h-4 w-4 mr-1" />
                Next
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Played: {formatTime(playlistElapsedMs)}</span>
              <span>Total: {formatTime(playlistTotals.total)}</span>
              <span>Remaining: {formatTime(playlistTotals.remaining)}</span>
            </div>
            <Progress value={durationMs ? Math.min(100, (elapsedMs / durationMs) * 100) : 0} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">SID options</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEditSongNr}
                  onClick={() => {
                    setSongNrInput(String(clampedSongNr));
                    setSongPickerOpen(true);
                  }}
                >
                  Song {clampedSongNr}/{subsongCount}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!sidControlsEnabled}
                  onClick={() => setDurationPickerOpen(true)}
                >
                  Duration {durationLabel}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Song picker enabled when subsongs are detected.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox checked={recurseFolders} onCheckedChange={(value) => setRecurseFolders(Boolean(value))} />
                <span className="text-xs">Recurse folders</span>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={shuffleEnabled} onCheckedChange={(value) => setShuffleEnabled(Boolean(value))} />
                <span className="text-xs flex items-center gap-1"><Shuffle className="h-3.5 w-3.5" /> Shuffle</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((category) => (
                  <label key={category} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Checkbox
                      checked={shuffleCategories.includes(category)}
                      onCheckedChange={() => toggleShuffleCategory(category)}
                      disabled={!shuffleEnabled}
                    />
                    {formatPlayCategory(category)}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Current duration</p>
              <div className="text-sm font-medium">{formatTime(durationMs)}</div>
              <Button variant="outline" size="sm" onClick={handleReshuffle} disabled={!shuffleEnabled || playlist.length < 2}>
                <Shuffle className="h-4 w-4 mr-1" />
                Reshuffle
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Playlist</p>
              <p className="text-xs text-muted-foreground">
                {playlist.length ? `${playlist.length} items` : 'No tracks in playlist yet'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPlaylistDialogOpen(true)} disabled={!playlist.length}>
              View all
            </Button>
          </div>
          <div className="space-y-2">
            {playlistPreview.length === 0 ? (
              <p className="text-xs text-muted-foreground">Play a file or folder to populate the playlist.</p>
            ) : (
              playlistPreview.map(({ item, index }) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full text-left px-2 py-2 rounded-md border ${index === currentIndex ? 'border-primary bg-primary/10' : 'border-transparent hover:border-muted'}`}
                  onClick={() => setPlaylistDialogOpen(true)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={index === currentIndex ? 'font-medium text-primary' : 'text-sm'}>{item.label}</span>
                    <span className="text-xs text-muted-foreground">{formatTime(playlistItemDuration(item, index))}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <Dialog open={playlistDialogOpen} onOpenChange={setPlaylistDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Playlist</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto space-y-2">
              {playlist.map((item, index) => (
                <div key={item.id} className="flex items-start justify-between gap-3 border-b border-border pb-2">
                  <div className="min-w-0">
                    <p className={`text-sm ${index === currentIndex ? 'font-medium text-primary' : ''}`}>{item.label}</p>
                    <p className="text-xs text-muted-foreground break-words">{item.path}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatTime(playlistItemDuration(item, index))}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void startPlaylist(playlist, index);
                        setPlaylistDialogOpen(false);
                      }}
                    >
                      Play
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={songPickerOpen} onOpenChange={setSongPickerOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>SID song number</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                type="number"
                min={1}
                max={subsongCount}
                value={songNrInput}
                onChange={(e) => setSongNrInput(e.target.value)}
                disabled={!canEditSongNr}
              />
              <p className="text-xs text-muted-foreground">
                Available songs: 1–{subsongCount}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSongPickerOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={durationPickerOpen} onOpenChange={setDurationPickerOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Local SID duration</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                placeholder="mm:ss or seconds"
                disabled={!sidControlsEnabled}
              />
              <p className="text-xs text-muted-foreground">Current: {durationLabel}</p>
            </div>
            <DialogFooter className="flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => {
                  setDurationInput('');
                  setDurationPickerOpen(false);
                }}
                disabled={!sidControlsEnabled}
              >
                Clear
              </Button>
              <Button variant="outline" onClick={() => setDurationPickerOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {source === 'local' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Local files</p>
                <p className="text-xs text-muted-foreground">
                  {localFiles.length ? `${localFiles.length} supported files selected` : 'Pick a folder to begin'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={localFolderInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  data-testid="play-folder-input"
                  onChange={(e) => void handleLocalFolderInput(e.target.files)}
                />
                <input
                  ref={localFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  data-testid="play-file-input"
                  onChange={(e) => void handleLocalFolderInput(e.target.files)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLocalBrowse}
                  disabled={isLocalLoading}
                >
                  <FolderOpen className="h-4 w-4 mr-1" />
                  {isLocalLoading ? 'Browsing…' : 'Browse local folders'}
                </Button>
                <Button variant="default" size="sm" onClick={() => void handlePlayFolder('local', localPath)} disabled={isLocalLoading || !localFiles.length}>
                  <Play className="h-4 w-4 mr-1" />
                  Play folder
                </Button>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Path: {localPath}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocalPath(getParentPath(localPath))}
                  disabled={localPath === '/'}
                >
                  <ArrowUp className="h-4 w-4 mr-1" />
                  Up
                </Button>
              </div>

              <div className="space-y-2">
                {localEntries.length === 0 && (
                  <p className="text-xs text-muted-foreground">No supported files in this folder.</p>
                )}
                {localEntries.map((entry) => (
                  <div key={entry.path} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.path}</p>
                    </div>
                    {entry.type === 'dir' ? (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setLocalPath(entry.path)}>
                          <FolderOpen className="h-4 w-4 mr-1" />
                          Open
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => void handlePlayFolder('local', entry.path)}
                          disabled={isLocalLoading}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Play
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() =>
                          void handlePlayEntry({
                            source: 'local',
                            type: 'file',
                            name: entry.name,
                            path: entry.path,
                            file: entry.file,
                            durationMs: entry.durationMs,
                          })
                        }
                        disabled={!status.isConnected}
                      >
                        <Play className="h-4 w-4 mr-1" />
                        Play
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Ultimate 64 FTP</p>
                <p className="text-xs text-muted-foreground">Browse files available on the device.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void handlePlayFolder('ultimate', remotePath)}
                  disabled={isRemoteLoading || !status.isConnected}
                >
                  <Play className="h-4 w-4 mr-1" />
                  Play folder
                </Button>
                <Button variant="outline" size="sm" onClick={() => void loadRemoteEntries(remotePath)} disabled={isRemoteLoading}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {isRemoteLoading ? 'Loading…' : 'Refresh'}
                </Button>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Path: {remotePath}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadRemoteEntries(getParentPath(remotePath))}
                  disabled={remotePath === '/'}
                >
                  <ArrowUp className="h-4 w-4 mr-1" />
                  Up
                </Button>
              </div>

              <div className="space-y-2">
                {remoteEntriesView.length === 0 && (
                  <p className="text-xs text-muted-foreground">No supported files in this folder.</p>
                )}
                {remoteEntriesView.map((entry) => (
                  <div key={entry.path} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.path}</p>
                    </div>
                    {entry.type === 'dir' ? (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => void loadRemoteEntries(entry.path)}>
                          <FolderOpen className="h-4 w-4 mr-1" />
                          Open
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => void handlePlayFolder('ultimate', entry.path)}
                          disabled={!status.isConnected || isRemoteLoading}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Play
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() =>
                          void handlePlayEntry({
                            source: 'ultimate',
                            type: 'file',
                            name: entry.name,
                            path: entry.path,
                          })
                        }
                        disabled={!status.isConnected}
                      >
                        <Play className="h-4 w-4 mr-1" />
                        Play
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">HVSC library</p>
                <p className="text-xs text-muted-foreground">
                  {hvscInstalled
                    ? `Installed version ${hvscStatus?.installedVersion ?? '—'}`
                    : 'Install HVSC to browse the SID collection.'}
                </p>
              </div>
              {hvscControlsEnabled && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void handleHvscInstall()}
                    disabled={hvscUpdating || !hvscAvailable}
                  >
                    {hvscInstalled ? 'Check updates' : 'Install HVSC'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleHvscIngest()}
                    disabled={hvscUpdating || !hvscAvailable}
                  >
                    Ingest cached
                  </Button>
                </div>
              )}
            </div>

            {!hvscControlsEnabled && (
              <p className="text-xs text-muted-foreground">
                HVSC downloads are disabled. Enable them in Settings to install the library.
              </p>
            )}

            {!hvscAvailable && (
              <p className="text-xs text-muted-foreground">
                HVSC controls are available on native builds or when a mock bridge is enabled.
              </p>
            )}

            {hvscUpdating && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{hvscActionLabel || 'Processing HVSC…'}</span>
                  <span>{hvscProgress !== null ? `${Math.round(hvscProgress)}%` : '—'}</span>
                </div>
                <Progress value={hvscProgress ?? 0} />
                {hvscStage && (
                  <p className="text-[11px] text-muted-foreground">Stage: {hvscStage}</p>
                )}
                {hvscCurrentFile && (
                  <p className="text-[11px] text-muted-foreground truncate">Current: {hvscCurrentFile}</p>
                )}
              </div>
            )}

            {hvscInlineError && (
              <p className="text-xs text-destructive">{hvscInlineError}</p>
            )}

            {hvscInstalled && hvscAvailable && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Browse HVSC folders</p>
                    <p className="text-xs text-muted-foreground">Play SID files from the collection.</p>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void handlePlayHvscFolder(selectedHvscFolder)}
                    disabled={hvscUpdating}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Play folder
                  </Button>
                </div>

                <Input
                  placeholder="Filter folders…"
                  value={hvscFolderFilter}
                  onChange={(e) => setHvscFolderFilter(e.target.value)}
                />

                <div className="grid gap-2 sm:grid-cols-2">
                  {hvscVisibleFolders.slice(0, 24).map((folder) => (
                    <div key={folder} className="flex items-center gap-2">
                      <Button
                        variant={folder === selectedHvscFolder ? 'secondary' : 'outline'}
                        size="sm"
                        className="flex-1 justify-start"
                        onClick={() => void loadHvscFolder(folder)}
                      >
                        <FolderOpen className="h-4 w-4 mr-1" />
                        {folder}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => void handlePlayHvscFolder(folder)}
                        disabled={hvscUpdating}
                      >
                        <Play className="h-4 w-4 mr-1" />
                        Play
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  {hvscSongs.length === 0 && (
                    <p className="text-xs text-muted-foreground">No songs in this folder.</p>
                  )}
                  {hvscSongs.slice(0, 80).map((song) => (
                    <div key={song.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium break-words whitespace-normal">{song.fileName}</p>
                        <p className="text-xs text-muted-foreground break-words whitespace-normal">{song.virtualPath}</p>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() =>
                          void handlePlayEntry({
                            source: 'local',
                            type: 'file',
                            name: song.fileName,
                            path: song.virtualPath,
                            file: buildHvscFile(song),
                            durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
                          })
                        }
                        disabled={hvscUpdating}
                      >
                        <Play className="h-4 w-4 mr-1" />
                        Play
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
      </main>
    </div>
  );
}

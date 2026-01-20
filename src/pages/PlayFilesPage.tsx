import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderOpen, Play, Repeat, Shuffle, SkipBack, SkipForward, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { useC64Connection } from '@/hooks/useC64Connection';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useFileLibrary } from '@/hooks/useFileLibrary';
import { useLocalSources } from '@/hooks/useLocalSources';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { getC64API } from '@/lib/c64api';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import { buildPlayPlan, executePlayPlan, type PlaySource, type PlayRequest, type LocalPlayFile } from '@/lib/playback/playbackRouter';
import { formatPlayCategory, getPlayCategory, isSupportedPlayFile, type PlayFileCategory } from '@/lib/playback/fileTypes';
import type { FileLibraryEntry } from '@/lib/playback/fileLibraryTypes';
import { buildFileLibraryId, resolvePlayRequestFromLibrary } from '@/lib/playback/fileLibraryUtils';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { createLocalSourceLocation, resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { prepareDirectoryInput } from '@/lib/sourceNavigation/localSourcesStore';
import type { SelectedItem, SourceLocation } from '@/lib/sourceNavigation/types';
import { base64ToUint8, computeSidMd5 } from '@/lib/sid/sidUtils';
import { parseSonglengths } from '@/lib/sid/songlengths';
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

type PlayableEntry = {
  source: PlaySource;
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

const CATEGORY_OPTIONS: PlayFileCategory[] = ['sid', 'mod', 'prg', 'crt', 'disk'];

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

const shuffleArray = <T,>(items: T[]) => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
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
  const uniqueId = status.deviceInfo?.unique_id || 'default';
  const fileLibrary = useFileLibrary(uniqueId);
  const { sources: localSources, addSourceFromPicker, addSourceFromFiles } = useLocalSources();
  const [browserOpen, setBrowserOpen] = useState(false);
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
  const [repeatEnabled, setRepeatEnabled] = useState(false);
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

  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const playlistStartedAtRef = useRef<number | null>(null);
  const songlengthsCacheRef = useRef(new Map<string, Promise<{ md5ToSeconds: Map<string, number>; pathToSeconds: Map<string, number> } | null>>());

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, []);

  useEffect(() => {
    songlengthsCacheRef.current.clear();
  }, [fileLibrary.entries]);

  const songlengthsFilesByDir = useMemo(() => {
    const map = new Map<string, LocalPlayFile>();
    fileLibrary.entries.forEach((entry) => {
      if (entry.name.toLowerCase() !== 'songlengths.md5') return;
      const runtime = fileLibrary.runtimeFiles[entry.id];
      if (!runtime) return;
      const path = getLocalFilePath(runtime);
      const folder = path.slice(0, path.lastIndexOf('/') + 1) || '/';
      map.set(folder, runtime);
    });
    return map;
  }, [fileLibrary.entries, fileLibrary.runtimeFiles]);

  const readLocalText = useCallback(async (file: LocalPlayFile) => {
    if (file instanceof File && typeof file.text === 'function') {
      return file.text();
    }
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  }, []);

  const loadSonglengthsForPath = useCallback(async (path: string) => {
    const normalized = normalizeLocalPath(path || '/');
    const folderPath = normalized.endsWith('/') ? normalized : `${normalized.slice(0, normalized.lastIndexOf('/') + 1)}`;
    const cacheKey = folderPath || '/';
    if (songlengthsCacheRef.current.has(cacheKey)) {
      return songlengthsCacheRef.current.get(cacheKey) ?? null;
    }

    const loader = (async () => {
      const files: LocalPlayFile[] = [];
      let current = cacheKey;
      while (current) {
        const candidate = songlengthsFilesByDir.get(current);
        if (candidate) files.push(candidate);
        if (current === '/') break;
        current = getParentPath(current);
      }
      if (!files.length) return null;
      const merged = { md5ToSeconds: new Map<string, number>(), pathToSeconds: new Map<string, number>() };
      const ordered = files.slice().reverse();
      for (const file of ordered) {
        try {
          const content = await readLocalText(file);
          const parsed = parseSonglengths(content);
          parsed.pathToSeconds.forEach((value, key) => merged.pathToSeconds.set(key, value));
          parsed.md5ToSeconds.forEach((value, key) => merged.md5ToSeconds.set(key, value));
        } catch {
          // Ignore malformed songlengths files.
        }
      }
      return merged;
    })();

    songlengthsCacheRef.current.set(cacheKey, loader);
    return loader;
  }, [readLocalText, songlengthsFilesByDir]);

  const localSourcesById = useMemo(
    () => new Map(localSources.map((source) => [source.id, source])),
    [localSources],
  );

  const sourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    const localGroupSources = localSources.map((source) => createLocalSourceLocation(source));
    return [
      { label: 'C64 Ultimate', sources: [ultimateSource] },
      { label: 'This device', sources: localGroupSources },
    ];
  }, [localSources]);

  const handleLocalSourceInput = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    addSourceFromFiles(files);
  }, [addSourceFromFiles]);

  const handleAddFileSelections = useCallback(async (source: SourceLocation, selections: SelectedItem[]) => {
    try {
      const selectedFiles: Array<{ path: string; name: string; sourceId?: string | null; sizeBytes?: number | null; modifiedAt?: string | null }> = [];
      for (const selection of selections) {
        if (selection.type === 'dir') {
          const nested = await source.listFilesRecursive(selection.path);
          nested.forEach((entry) => {
            if (entry.type !== 'file') return;
            selectedFiles.push({ path: entry.path, name: entry.name, sourceId: source.id, sizeBytes: entry.sizeBytes, modifiedAt: entry.modifiedAt });
          });
        } else {
          const normalized = normalizeSourcePath(selection.path);
          selectedFiles.push({ path: normalized, name: selection.name, sourceId: source.id });
        }
      }

      const libraryEntries: FileLibraryEntry[] = [];
      const runtimeFiles: Record<string, LocalPlayFile> = {};

      selectedFiles.forEach((file) => {
        const category = getPlayCategory(file.path);
        if (!category) return;
        const sourceId = source.type === 'local' ? source.id : undefined;
        const id = buildFileLibraryId(source.type === 'ultimate' ? 'ultimate' : 'local', file.path, sourceId);
        const localSource = source.type === 'local' ? localSourcesById.get(source.id) : null;
        const localEntry = localSource?.entries.find((item) => normalizeSourcePath(item.relativePath) === normalizeSourcePath(file.path));
        const entry: FileLibraryEntry = {
          id,
          source: source.type === 'ultimate' ? 'ultimate' : 'local',
          sourceId: sourceId ?? null,
          name: file.name,
          path: file.path,
          category,
          localUri: localEntry?.uri ?? null,
          addedAt: new Date().toISOString(),
        };
        if (source.type === 'local') {
          const runtime = resolveLocalRuntimeFile(source.id, file.path);
          if (runtime) runtimeFiles[id] = runtime;
        }
        libraryEntries.push(entry);
      });

      if (!libraryEntries.length) {
        toast({ title: 'No supported files', description: 'Found no supported files.', variant: 'destructive' });
        return;
      }

      fileLibrary.addEntries(libraryEntries, runtimeFiles);
      toast({ title: 'Items added', description: `${libraryEntries.length} file(s) added to library.` });
    } catch (error) {
      toast({ title: 'Add items failed', description: (error as Error).message, variant: 'destructive' });
    }
  }, [fileLibrary, localSourcesById]);


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

      const filePath = getLocalFilePath(file);
      const songlengths = await loadSonglengthsForPath(filePath);
      if (songlengths?.pathToSeconds.has(filePath)) {
        const seconds = songlengths.pathToSeconds.get(filePath);
        return { durationMs: seconds ? seconds * 1000 : undefined, subsongCount } as const;
      }

      const md5 = await computeSidMd5(buffer);
      const md5Duration = songlengths?.md5ToSeconds.get(md5);
      if (md5Duration) {
        return { durationMs: md5Duration * 1000, subsongCount } as const;
      }
      const seconds = await getHvscDurationByMd5Seconds(md5);
      return { durationMs: seconds ? seconds * 1000 : undefined, subsongCount } as const;
    } catch {
      return { durationMs: override, subsongCount: undefined } as const;
    }
  }, [durationInput, loadSonglengthsForPath]);

  const applySonglengthsToItems = useCallback(async (items: PlaylistItem[]) => {
    const updated = await Promise.all(
      items.map(async (item) => {
        if (item.category !== 'sid' || item.request.source !== 'local' || !item.request.file) return item;
        const filePath = getLocalFilePath(item.request.file);
        const songlengths = await loadSonglengthsForPath(filePath);
        const seconds = songlengths?.pathToSeconds.get(filePath);
        if (!seconds) return item;
        return { ...item, durationMs: seconds * 1000 };
      }),
    );
    return updated;
  }, [loadSonglengthsForPath]);

  const buildPlaylistItem = useCallback((entry: PlayableEntry): PlaylistItem | null => {
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

  const toPlayableEntry = useCallback((entry: FileLibraryEntry): PlayableEntry => {
    const request = resolvePlayRequestFromLibrary(entry, fileLibrary.runtimeFiles);
    return {
      source: request.source,
      name: entry.name,
      path: request.path,
      file: request.file,
      durationMs: entry.durationMs,
    };
  }, [fileLibrary.runtimeFiles]);

  const buildPlaylistItemFromLibrary = useCallback((entry: FileLibraryEntry) => {
    const playable = toPlayableEntry(entry);
    return buildPlaylistItem(playable);
  }, [buildPlaylistItem, toPlayableEntry]);

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
    const resolvedItems = await applySonglengthsToItems(items);
    setPlaylist(resolvedItems);
    setCurrentIndex(startIndex);
    playlistStartedAtRef.current = Date.now();
    setPlaylistElapsedMs(0);
    setIsPlaylistLoading(true);
    try {
      await playItem(resolvedItems[startIndex]);
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [applySonglengthsToItems, playItem]);

  const handleNext = useCallback(async () => {
    if (!playlist.length) return;
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (!repeatEnabled) {
        setIsPlaying(false);
        return;
      }
      nextIndex = 0;
      playlistStartedAtRef.current = Date.now();
      setPlaylistElapsedMs(0);
    }
    setCurrentIndex(nextIndex);
    await playItem(playlist[nextIndex]);
  }, [currentIndex, playItem, playlist, repeatEnabled]);

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
      const shuffled = shuffleArray(tail);
      return [...head, ...shuffled];
    });
  }, [currentIndex, playlist.length, shuffleEnabled]);

  const handleRemovePlaylistItem = useCallback((index: number) => {
    setPlaylist((prev) => prev.filter((_, entryIndex) => entryIndex !== index));
    setCurrentIndex((prevIndex) => {
      if (prevIndex < 0) return prevIndex;
      if (index === prevIndex) return -1;
      if (index < prevIndex) return prevIndex - 1;
      return prevIndex;
    });
    if (index === currentIndex) {
      setIsPlaying(false);
      setElapsedMs(0);
      setDurationMs(undefined);
      trackStartedAtRef.current = null;
    }
  }, [currentIndex]);

  const handleClearPlaylist = useCallback(() => {
    setPlaylist([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setElapsedMs(0);
    setDurationMs(undefined);
    setPlaylistElapsedMs(0);
    trackStartedAtRef.current = null;
    playlistStartedAtRef.current = null;
  }, []);

  const handlePlayEntry = useCallback(async (entry: PlayableEntry) => {
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

  const handlePlayLibrary = useCallback(async () => {
    try {
      if (!fileLibrary.entries.length) {
        toast({ title: 'Library empty', description: 'Add items to the file library first.', variant: 'destructive' });
        return;
      }
      const items = fileLibrary.entries
        .filter((entry) => shouldIncludeCategory(entry.path))
        .map(buildPlaylistItemFromLibrary)
        .filter((item): item is PlaylistItem => Boolean(item));
      if (!items.length) {
        toast({ title: 'No playable items', description: 'No items match the current filters.', variant: 'destructive' });
        return;
      }
      const queueItems = shuffleEnabled ? shuffleArray(items) : items;
      await startPlaylist(queueItems);
      toast({ title: 'Playback started', description: `${queueItems.length} files added to playlist` });
    } catch (error) {
      toast({ title: 'Playback failed', description: (error as Error).message, variant: 'destructive' });
    }
  }, [buildPlaylistItemFromLibrary, fileLibrary.entries, shouldIncludeCategory, shuffleEnabled, startPlaylist]);


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
      const entries: PlayableEntry[] = songs.map((song) => ({
        source: 'local',
        name: song.fileName,
        path: song.virtualPath,
        file: buildHvscFile(song),
        durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
      }));
      const items = entries
        .map(buildPlaylistItem)
        .filter((item): item is PlaylistItem => Boolean(item));
      if (!items.length) return;
      const playlistItems = shuffleEnabled ? shuffleArray(items) : items;
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

        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Playback controls</p>
              <p className="text-xs text-muted-foreground">
                {currentItem ? currentItem.label : 'Select a library item to start'}
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
              <div className="flex items-center gap-2">
                <Checkbox checked={repeatEnabled} onCheckedChange={(value) => setRepeatEnabled(Boolean(value))} />
                <span className="text-xs flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> Repeat</span>
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
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {playlist.length ? `${playlist.length} items` : 'No items'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearPlaylist}
                disabled={!playlist.length}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear playlist
              </Button>
            </div>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemovePlaylistItem(index)}
                      aria-label="Remove from playlist"
                    >
                      <X className="h-4 w-4" />
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

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">File library</p>
              <p className="text-xs text-muted-foreground">
                {fileLibrary.entries.length ? `${fileLibrary.entries.length} item(s) in the library` : 'Add items to start playback.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
                {fileLibrary.entries.length ? 'Add more items' : 'Add items'}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => void handlePlayLibrary()}
                disabled={!fileLibrary.entries.length || !status.isConnected}
              >
                <Play className="h-4 w-4 mr-1" />
                Play library
              </Button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            {fileLibrary.entries.length === 0 && (
              <p className="text-xs text-muted-foreground">No items yet. Add items to begin.</p>
            )}
            {fileLibrary.entries.map((entry) => {
              const sourceLabel = entry.source === 'ultimate'
                ? 'C64 Ultimate'
                : localSourcesById.get(entry.sourceId || '')?.name || 'This device';
              return (
                <div key={entry.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                    <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.path}</p>
                    <p className="text-[11px] text-muted-foreground">{sourceLabel}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handlePlayEntry(toPlayableEntry(entry))}
                      disabled={!status.isConnected}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Play
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileLibrary.removeEntry(entry.id)}
                      aria-label="Remove from library"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <input
          ref={localSourceInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => handleLocalSourceInput(event.target.files)}
        />

        <ItemSelectionDialog
          open={browserOpen}
          onOpenChange={setBrowserOpen}
          title="Add items"
          confirmLabel="Add to library"
          sourceGroups={sourceGroups}
          onAddLocalSource={() => void addSourceFromPicker(localSourceInputRef.current)}
          onConfirm={handleAddFileSelections}
          filterEntry={(entry) => entry.type === 'dir' || isSupportedPlayFile(entry.path)}
          allowFolderSelection
        />

        {hvscControlsEnabled && (
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
            </div>

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
        )}
      </main>
    </div>
  );
}

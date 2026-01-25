import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Folder, FolderOpen, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { SelectableActionList, type ActionListItem, type ActionListMenuItem } from '@/components/lists/SelectableActionList';
import { AddItemsProgressOverlay, type AddItemsProgressState } from '@/components/itemSelection/AddItemsProgressOverlay';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { FileOriginIcon } from '@/components/FileOriginIcon';
import { useC64Category, useC64Connection, useC64UpdateConfigBatch } from '@/hooks/useC64Connection';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { useLocalSources } from '@/hooks/useLocalSources';
import { toast } from '@/hooks/use-toast';
import { addErrorLog, addLog } from '@/lib/logging';
import { getC64API } from '@/lib/c64api';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from '@/lib/playback/fileLibraryUtils';
import { buildPlayPlan, executePlayPlan, type PlaySource, type PlayRequest, type LocalPlayFile } from '@/lib/playback/playbackRouter';
import { formatPlayCategory, getPlayCategory, isSupportedPlayFile, type PlayFileCategory } from '@/lib/playback/fileTypes';
import { PlaybackClock } from '@/lib/playback/playbackClock';
import { calculatePlaylistTotals } from '@/lib/playback/playlistTotals';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { createLocalSourceLocation, resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import {
  getLocalSourceListingMode,
  prepareDirectoryInput,
  requireLocalSourceEntries,
} from '@/lib/sourceNavigation/localSourcesStore';
import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';
import type { SelectedItem, SourceEntry, SourceLocation } from '@/lib/sourceNavigation/types';
import { base64ToUint8, computeSidMd5 } from '@/lib/sid/sidUtils';
import { parseSonglengths } from '@/lib/sid/songlengths';
import {
  collectSonglengthsSearchPaths,
  DOCUMENTS_FOLDER,
  SONGLENGTHS_FILE_NAMES,
} from '@/lib/sid/songlengthsDiscovery';
import { isSidVolumeName, resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';
import {
  buildEnabledSidMuteUpdates,
  buildEnabledSidRestoreUpdates,
  buildEnabledSidVolumeSnapshot,
  buildEnabledSidVolumeUpdates,
  buildSidEnablement,
  filterEnabledSidVolumeItems,
} from '@/lib/config/sidVolumeControl';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import { getPlatform } from '@/lib/native/platform';
import { redactTreeUri } from '@/lib/native/safUtils';
import {
  addHvscProgressListener,
  checkForHvscUpdates,
  getHvscDurationByMd5Seconds,
  getHvscFolderListing,
  getHvscSong,
  getHvscStatus,
  loadHvscStatusSummary,
  saveHvscStatusSummary,
  ingestCachedHvsc,
  installOrUpdateHvsc,
  isHvscBridgeAvailable,
  type HvscFailureCategory,
  type HvscProgressEvent,
  type HvscStatusSummary,
  type HvscStatus,
} from '@/lib/hvsc';
import { AppBar } from '@/components/AppBar';

type PlayableEntry = {
  source: PlaySource;
  name: string;
  path: string;
  file?: LocalPlayFile;
  durationMs?: number;
  sourceId?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

type PlaylistItem = {
  id: string;
  request: PlayRequest;
  category: PlayFileCategory;
  label: string;
  path: string;
  durationMs?: number;
  subsongCount?: number;
  sourceId?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  addedAt?: string | null;
};

type StoredPlaylistState = {
  items: Array<{
    source: PlaySource;
    path: string;
    name: string;
    durationMs?: number;
    songNr?: number;
    sourceId?: string | null;
    sizeBytes?: number | null;
    modifiedAt?: string | null;
    addedAt?: string | null;
  }>;
  currentIndex?: number;
};

type AudioMixerItem = {
  name: string;
  value: string | number;
  options?: string[];
};

const CATEGORY_OPTIONS: PlayFileCategory[] = ['sid', 'mod', 'prg', 'crt', 'disk'];
const buildPlaylistStorageKey = (deviceId: string) => `c64u_playlist:v1:${deviceId}`;
const DEFAULT_SONG_DURATION_MS = 3 * 60 * 1000;
const DURATION_MIN_SECONDS = 1;
const DURATION_MAX_SECONDS = 3600;
const DURATION_SLIDER_STEPS = 1000;

const formatTime = (ms?: number) => {
  if (ms === undefined) return '—';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
};

const isSongCategory = (category: PlayFileCategory) => category === 'sid' || category === 'mod';

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

const getLocalFilePath = (file: LocalPlayFile) => {
  const candidate =
    (file as File).webkitRelativePath || (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return normalizeLocalPath(candidate);
};

const isSonglengthsFileName = (name: string) =>
  SONGLENGTHS_FILE_NAMES.includes(name.trim().toLowerCase());


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

const clampDurationSeconds = (value: number) =>
  Math.min(DURATION_MAX_SECONDS, Math.max(DURATION_MIN_SECONDS, value));

const formatDurationSeconds = (seconds: number) => formatTime(seconds * 1000);

const durationSecondsToSlider = (seconds: number) => {
  const clamped = clampDurationSeconds(seconds);
  const ratio = Math.log(clamped / DURATION_MIN_SECONDS) / Math.log(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS);
  return Math.round(ratio * DURATION_SLIDER_STEPS);
};

const sliderToDurationSeconds = (value: number) => {
  const ratio = Math.min(1, Math.max(0, value / DURATION_SLIDER_STEPS));
  const seconds = DURATION_MIN_SECONDS * Math.pow(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS, ratio);
  return clampDurationSeconds(Math.round(seconds));
};

const parseVolumeOption = (option: string) => {
  const match = option.trim().match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

const parseModifiedAt = (value?: string | null) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const extractAudioMixerItems = (payload: Record<string, unknown> | undefined): AudioMixerItem[] => {
  if (!payload) return [];
  const categoryData = (payload as Record<string, any>)['Audio Mixer'] ?? payload;
  const itemsData = (categoryData as Record<string, any>)?.items ?? categoryData;
  if (!itemsData || typeof itemsData !== 'object') return [];
  return Object.entries(itemsData)
    .filter(([key]) => key !== 'errors')
    .map(([name, config]) => ({
      name,
      ...normalizeConfigItem(config),
    }));
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
  const updateConfigBatch = useC64UpdateConfigBatch();
  const { data: audioMixerCategory } = useC64Category('Audio Mixer', status.isConnected || status.isConnecting);
  const { data: sidSocketsCategory } = useC64Category('SID Sockets Configuration', status.isConnected || status.isConnecting);
  const { data: sidAddressingCategory } = useC64Category('SID Addressing', status.isConnected || status.isConnecting);
  const uniqueId = status.deviceInfo?.unique_id || 'default';
  const { sources: localSources, addSourceFromPicker, addSourceFromFiles } = useLocalSources();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [durationSeconds, setDurationSeconds] = useState(() => Math.round(DEFAULT_SONG_DURATION_MS / 1000));
  const [durationInput, setDurationInput] = useState(() => formatDurationSeconds(Math.round(DEFAULT_SONG_DURATION_MS / 1000)));
  const [songNrInput, setSongNrInput] = useState('');
  const [currentSubsongCount, setCurrentSubsongCount] = useState<number | null>(null);
  const [songlengthsFiles, setSonglengthsFiles] = useState<Array<{ path: string; file: LocalPlayFile }>>([]);
  const [recurseFolders, setRecurseFolders] = useState(true);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [shuffleCategories, setShuffleCategories] = useState<PlayFileCategory[]>(CATEGORY_OPTIONS);
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [addItemsProgress, setAddItemsProgress] = useState<AddItemsProgressState>({
    status: 'idle',
    count: 0,
    elapsedMs: 0,
    total: null,
    message: null,
  });
  const [showAddItemsOverlay, setShowAddItemsOverlay] = useState(false);
  const [isAddingItems, setIsAddingItems] = useState(false);
  const addItemsOverlayStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayActiveRef = useRef(false);
  const [addItemsSurface, setAddItemsSurface] = useState<'dialog' | 'page'>('dialog');
  const { limit: listPreviewLimit } = useListPreviewLimit();
  const isAndroid = getPlatform() === 'android';

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

  const audioMixerItems = useMemo(() => extractAudioMixerItems(audioMixerCategory as Record<string, unknown> | undefined), [audioMixerCategory]);
  const sidVolumeItems = useMemo(
    () => audioMixerItems.filter((item) => isSidVolumeName(item.name)),
    [audioMixerItems],
  );
  const sidEnablement = useMemo(
    () =>
      buildSidEnablement(
        sidSocketsCategory as Record<string, unknown> | undefined,
        sidAddressingCategory as Record<string, unknown> | undefined,
      ),
    [sidAddressingCategory, sidSocketsCategory],
  );
  const enabledSidVolumeItems = useMemo(
    () => filterEnabledSidVolumeItems(sidVolumeItems, sidEnablement),
    [sidEnablement, sidVolumeItems],
  );
  const volumeOptions = useMemo(() => {
    const baseOptions = sidVolumeItems.find((item) => Array.isArray(item.options) && item.options.length)?.options ?? [];
    return baseOptions
      .map((option) => ({
        option,
        label: option.trim(),
        numeric: parseVolumeOption(option),
      }))
      .filter((entry): entry is { option: string; label: string; numeric: number } => entry.numeric !== undefined);
  }, [sidVolumeItems]);

  const [hvscStatus, setHvscStatus] = useState<HvscStatus | null>(null);
  const [hvscStatusSummary, setHvscStatusSummary] = useState<HvscStatusSummary>(() => loadHvscStatusSummary());
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
  const [volumeIndex, setVolumeIndex] = useState(0);
  const [volumeMuted, setVolumeMuted] = useState(false);
  const hvscLastStageRef = useRef<string | null>(null);

  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const songlengthsInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const playedClockRef = useRef(new PlaybackClock());
  const songlengthsCacheRef = useRef(
    new Map<string, {
      signature: string;
      promise: Promise<{ md5ToSeconds: Map<string, number>; pathToSeconds: Map<string, number> } | null>;
    }>(),
  );
  const songlengthsFileCacheRef = useRef(new Map<string, { mtime: number; data: { md5ToSeconds: Map<string, number>; pathToSeconds: Map<string, number> } | null }>());
  const addItemsStartedAtRef = useRef<number | null>(null);
  const manualMuteSnapshotRef = useRef<Record<string, string | number> | null>(null);
  const pauseMuteSnapshotRef = useRef<Record<string, string | number> | null>(null);

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, []);

  const updateHvscSummary = useCallback((updater: (prev: HvscStatusSummary) => HvscStatusSummary) => {
    setHvscStatusSummary((prev) => {
      const next = updater(prev);
      saveHvscStatusSummary(next);
      return next;
    });
  }, []);

  const resolveHvscFailureCategory = useCallback((event: HvscProgressEvent, lastStage: string | null): HvscFailureCategory => {
    const details = `${event.errorType ?? ''} ${event.errorCause ?? ''}`.toLowerCase();
    const isNetwork = /timeout|network|socket|host|dns|connection|ssl|refused|reset/.test(details);
    const isStorage = /disk|space|permission|storage|file|io|not found|readonly|denied|enospc|eacces/.test(details);
    if (isNetwork) return 'network';
    if (isStorage) return 'storage';
    if (lastStage === 'download') return 'download';
    if (
      lastStage === 'archive_extraction' ||
      lastStage === 'archive_validation' ||
      lastStage === 'sid_enumeration' ||
      lastStage === 'songlengths' ||
      lastStage === 'sid_metadata_parsing'
    ) {
      return 'extraction';
    }
    return 'unknown';
  }, []);

  const formatHvscDuration = (durationMs?: number | null) => {
    if (!durationMs && durationMs !== 0) return '—';
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatHvscTimestamp = (value?: string | null) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  };

  const handleSonglengthsInput = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const path = normalizeSourcePath(getLocalFilePath(file));
    setSonglengthsFiles([{ path, file }]);
  }, []);

  const defaultVolumeIndex = useMemo(() => {
    const zeroIndex = volumeOptions.findIndex((option) => option.numeric === 0);
    return zeroIndex >= 0 ? zeroIndex : 0;
  }, [volumeOptions]);

  const resolveVolumeIndex = useCallback((value: string | number) => {
    if (!volumeOptions.length) return defaultVolumeIndex;
    const stringValue = typeof value === 'string' ? value.trim() : value.toString();
    const directIndex = volumeOptions.findIndex((option) => option.option.trim() === stringValue);
    if (directIndex >= 0) return directIndex;
    const numeric = typeof value === 'number' ? value : parseVolumeOption(value);
    if (numeric !== undefined) {
      const numericIndex = volumeOptions.findIndex((option) => option.numeric === numeric);
      if (numericIndex >= 0) return numericIndex;
    }
    return defaultVolumeIndex;
  }, [defaultVolumeIndex, volumeOptions]);

  const buildSidVolumeSnapshot = useCallback((items: AudioMixerItem[]) => {
    const snapshot: Record<string, string | number> = {};
    items.forEach((item) => {
      snapshot[item.name] = item.value;
    });
    return snapshot;
  }, []);

  const buildSidMuteUpdates = useCallback((items: AudioMixerItem[]) => {
    const updates: Record<string, string | number> = {};
    items.forEach((item) => {
      updates[item.name] = resolveAudioMixerMuteValue(item.options);
    });
    return updates;
  }, []);

  const applyAudioMixerUpdates = useCallback(async (updates: Record<string, string | number>, context: string) => {
    if (!Object.keys(updates).length) return;
    try {
      await updateConfigBatch.mutateAsync({ category: 'Audio Mixer', updates });
    } catch (error) {
      addErrorLog(`${context} audio mixer update failed`, { error: (error as Error).message });
      toast({
        title: 'Audio mixer update failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [updateConfigBatch]);

  const resolveSidVolumeItems = useCallback(async (forceRefresh = false) => {
    if (sidVolumeItems.length && !forceRefresh) return sidVolumeItems;
    try {
      const data = await getC64API().getCategory('Audio Mixer');
      return extractAudioMixerItems(data as Record<string, unknown>).filter((item) => isSidVolumeName(item.name));
    } catch (error) {
      addErrorLog('Audio mixer lookup failed', { error: (error as Error).message });
      return [];
    }
  }, [sidVolumeItems]);

  const resolveEnabledSidVolumeItems = useCallback(async (forceRefresh = false) => {
    const items = await resolveSidVolumeItems(forceRefresh);
    return filterEnabledSidVolumeItems(items, sidEnablement);
  }, [resolveSidVolumeItems, sidEnablement]);

  useEffect(() => {
    if (!enabledSidVolumeItems.length || !volumeOptions.length) {
      setVolumeMuted(false);
      setVolumeIndex(defaultVolumeIndex);
      return;
    }
    const muteValues = enabledSidVolumeItems.map((item) => resolveAudioMixerMuteValue(item.options));
    const activeIndices: number[] = [];
    enabledSidVolumeItems.forEach((item, index) => {
      if (item.value === muteValues[index]) return;
      activeIndices.push(resolveVolumeIndex(item.value));
    });
    if (!activeIndices.length) {
      setVolumeMuted(true);
      setVolumeIndex(defaultVolumeIndex);
      return;
    }
    setVolumeMuted(false);
    const counts = new Map<number, number>();
    activeIndices.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
    const nextIndex = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
    setVolumeIndex(nextIndex);
  }, [defaultVolumeIndex, enabledSidVolumeItems, resolveVolumeIndex, volumeOptions]);

  useEffect(() => {
    setSelectedPlaylistIds((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(playlist.map((item) => item.id));
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [playlist]);

  useEffect(() => {
    if (playlist.length > 0) return;
    playedClockRef.current.reset();
    setPlayedMs(0);
  }, [playlist.length]);

  useEffect(() => {
    if (isPlaying || isPaused) return;
    const now = Date.now();
    playedClockRef.current.stop(now, true);
    trackStartedAtRef.current = null;
    setPlayedMs(0);
  }, [isPaused, isPlaying]);

  useEffect(() => {
    if (addItemsProgress.status !== 'scanning') return undefined;
    const interval = window.setInterval(() => {
      const startedAt = addItemsStartedAtRef.current ?? Date.now();
      setAddItemsProgress((prev) => ({
        ...prev,
        elapsedMs: Date.now() - startedAt,
      }));
    }, 500);
    return () => window.clearInterval(interval);
  }, [addItemsProgress.status]);

  useEffect(() => {
    if (browserOpen) {
      setAddItemsSurface('dialog');
    }
  }, [browserOpen]);

  useEffect(() => {
    songlengthsCacheRef.current.clear();
  }, [playlist, songlengthsFiles]);

  const songlengthsFilesByDir = useMemo(() => {
    const map = new Map<string, LocalPlayFile>();
    const addSonglengthsFile = (file: LocalPlayFile, pathOverride?: string) => {
      const path = pathOverride ?? getLocalFilePath(file);
      const folder = path.slice(0, path.lastIndexOf('/') + 1) || '/';
      const existing = map.get(folder);
      if (existing) {
        const existingPath = getLocalFilePath(existing).toLowerCase();
        const nextPath = path.toLowerCase();
        const existingIsMd5 = existingPath.endsWith('.md5');
        const nextIsMd5 = nextPath.endsWith('.md5');
        if (existingIsMd5 && !nextIsMd5) return;
        if (!existingIsMd5 && nextIsMd5) {
          map.set(folder, file);
          return;
        }
      }
      map.set(folder, file);
    };
    playlist.forEach((item) => {
      if (item.request.source !== 'local' || !item.request.file) return;
      if (!isSonglengthsFileName(item.label)) return;
      addSonglengthsFile(item.request.file);
    });
    songlengthsFiles.forEach((entry) => addSonglengthsFile(entry.file, entry.path));
    return map;
  }, [playlist, songlengthsFiles]);

  const activeSonglengthsPath = songlengthsFiles[0]?.path ?? null;

  const readLocalText = useCallback(async (file: LocalPlayFile) => {
    if (file instanceof File && typeof file.text === 'function') {
      return file.text();
    }
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(buffer));
  }, []);

  const loadSonglengthsForPath = useCallback(async (
    path: string,
    extraFiles?: Array<{ path: string; file: LocalPlayFile }>,
  ) => {
    const normalized = normalizeLocalPath(path || '/');
    const folderPath = normalized.endsWith('/') ? normalized : `${normalized.slice(0, normalized.lastIndexOf('/') + 1)}`;
    const cacheKey = folderPath || '/';
    const filesByDir = extraFiles?.length
      ? extraFiles.reduce((map, entry) => {
          const normalizedPath = normalizeSourcePath(entry.path);
          const folder = normalizedPath.slice(0, normalizedPath.lastIndexOf('/') + 1) || '/';
          map.set(folder, entry.file);
          return map;
        }, new Map(songlengthsFilesByDir))
      : songlengthsFilesByDir;
    const files = new Map<string, LocalPlayFile>();
    let current = cacheKey;
    while (current) {
      const candidate = filesByDir.get(current);
      if (candidate) files.set(getLocalFilePath(candidate), candidate);
      const docsCandidate = filesByDir.get(`${current}${DOCUMENTS_FOLDER}/`);
      if (docsCandidate) files.set(getLocalFilePath(docsCandidate), docsCandidate);
      if (current === '/') break;
      current = getParentPath(current);
    }
    if (!files.size) return null;

    const signature = Array.from(files.values())
      .map((file) => `${getLocalFilePath(file)}:${typeof file.lastModified === 'number' ? file.lastModified : 0}`)
      .sort()
      .join('|');
    const cached = songlengthsCacheRef.current.get(cacheKey);
    if (cached && cached.signature === signature) {
      return cached.promise;
    }

    const loader = (async () => {
      const merged = { md5ToSeconds: new Map<string, number>(), pathToSeconds: new Map<string, number>() };
      const ordered = Array.from(files.values()).reverse();
      for (const file of ordered) {
        try {
          const filePath = getLocalFilePath(file);
          const mtime = typeof file.lastModified === 'number' ? file.lastModified : 0;
          const cachedEntry = songlengthsFileCacheRef.current.get(filePath);
          if (cachedEntry && cachedEntry.mtime === mtime && cachedEntry.data) {
            cachedEntry.data.pathToSeconds.forEach((value, key) => merged.pathToSeconds.set(key, value));
            cachedEntry.data.md5ToSeconds.forEach((value, key) => merged.md5ToSeconds.set(key, value));
            continue;
          }
          const content = await readLocalText(file);
          const parsed = parseSonglengths(content);
          songlengthsFileCacheRef.current.set(filePath, { mtime, data: parsed });
          parsed.pathToSeconds.forEach((value, key) => merged.pathToSeconds.set(key, value));
          parsed.md5ToSeconds.forEach((value, key) => merged.md5ToSeconds.set(key, value));
        } catch {
          // Ignore malformed songlengths files.
          const filePath = getLocalFilePath(file);
          const mtime = typeof file.lastModified === 'number' ? file.lastModified : 0;
          songlengthsFileCacheRef.current.set(filePath, { mtime, data: null });
        }
      }
      return merged;
    })();

    songlengthsCacheRef.current.set(cacheKey, { signature, promise: loader });
    return loader;
  }, [readLocalText, songlengthsFilesByDir]);

  const playlistStorageKey = useMemo(() => buildPlaylistStorageKey(uniqueId), [uniqueId]);

  const handleAutoConfirmStart = useCallback(() => {
    setAddItemsSurface('page');
    setIsAddingItems(true);
    setShowAddItemsOverlay(true);
    addItemsOverlayStartedAtRef.current = Date.now();
    addItemsOverlayActiveRef.current = true;
  }, []);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status === 'scanning') return;
    setAddItemsProgress({ status: 'idle', count: 0, elapsedMs: 0, total: null, message: null });
  }, [addItemsProgress.status, browserOpen]);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status !== 'scanning') return;
    if (addItemsSurface !== 'page') {
      setAddItemsSurface('page');
    }
  }, [addItemsProgress.status, addItemsSurface, browserOpen]);

  useEffect(() => {
    if (addItemsProgress.status === 'scanning') return;
    if (addItemsSurface === 'page' && isAddingItems) return;
    if (addItemsSurface !== 'dialog') {
      setAddItemsSurface('dialog');
    }
  }, [addItemsProgress.status, addItemsSurface, isAddingItems]);


  const sourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    const localGroupSources = localSources.map((source) => createLocalSourceLocation(source));
    return [
      { label: 'C64 Ultimate', sources: [ultimateSource] },
      { label: 'This device', sources: localGroupSources },
    ];
  }, [localSources]);

  const localEntriesBySourceId = useMemo(() => {
    const map = new Map<
      string,
      Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>
    >();
    localSources.forEach((source) => {
      if (getLocalSourceListingMode(source) !== 'entries') {
        map.set(source.id, new Map());
        return;
      }
      try {
        const entries = requireLocalSourceEntries(source, 'PlayFilesPage.localEntriesBySourceId');
        const entriesMap = new Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>();
        entries.forEach((entry) => {
          entriesMap.set(normalizeSourcePath(entry.relativePath), {
            uri: entry.uri,
            name: entry.name,
            modifiedAt: entry.modifiedAt ?? null,
            sizeBytes: entry.sizeBytes ?? null,
          });
        });
        map.set(source.id, entriesMap);
      } catch (error) {
        addErrorLog('Local source entries unavailable', {
          sourceId: source.id,
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
        map.set(source.id, new Map());
      }
    });
    return map;
  }, [localSources]);

  const localSourceTreeUris = useMemo(() => {
    const map = new Map<string, string | null>();
    localSources.forEach((source) => {
      map.set(source.id, source.android?.treeUri ?? null);
    });
    return map;
  }, [localSources]);

  const handleLocalSourceInput = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    addSourceFromFiles(files);
  }, [addSourceFromFiles]);

  const buildPlaylistItem = useCallback((entry: PlayableEntry, songNrOverride?: number, addedAtOverride?: string | null): PlaylistItem | null => {
    const category = getPlayCategory(entry.path);
    if (!category) return null;
    const songNrValue = songNrOverride ?? (songNrInput.trim() === '' ? undefined : Math.max(1, Number(songNrInput)));
    const request: PlayRequest = {
      source: entry.source,
      path: entry.path,
      file: entry.file,
      songNr: Number.isNaN(songNrValue) ? undefined : songNrValue,
    };
    const idParts = [entry.source, entry.sourceId ?? ''];
    return {
      id: `${idParts.join(':')}:${entry.path}`,
      request,
      category,
      label: entry.name,
      path: entry.path,
      durationMs: entry.durationMs,
      sourceId: entry.sourceId ?? null,
      sizeBytes: entry.sizeBytes ?? null,
      modifiedAt: entry.modifiedAt ?? null,
      addedAt: addedAtOverride ?? new Date().toISOString(),
    };
  }, [songNrInput]);

  const applySonglengthsToItems = useCallback(async (
    items: PlaylistItem[],
    songlengthsOverrides?: Array<{ path: string; file: LocalPlayFile }>,
  ) => {
    const updated = await Promise.all(
      items.map(async (item) => {
        if (item.category !== 'sid' || item.request.source !== 'local' || !item.request.file) return item;
        const filePath = getLocalFilePath(item.request.file);
        const songlengths = await loadSonglengthsForPath(filePath, songlengthsOverrides);
        const seconds = songlengths?.pathToSeconds.get(filePath);
        if (seconds === undefined || seconds === null) return item;
        return { ...item, durationMs: seconds * 1000 };
      }),
    );
    return updated;
  }, [loadSonglengthsForPath]);

  const handleAddFileSelections = useCallback(async (source: SourceLocation, selections: SelectedItem[]) => {
    const startedAt = Date.now();
    addItemsStartedAtRef.current = startedAt;
    const localTreeUri = source.type === 'local' ? localSourceTreeUris.get(source.id) : null;
    if (localTreeUri) {
      addLog('debug', 'SAF scan started', {
        sourceId: source.id,
        treeUri: redactTreeUri(localTreeUri),
        rootPath: source.rootPath,
      });
    }
    if (!browserOpen) {
      setAddItemsSurface('page');
      if (!addItemsOverlayActiveRef.current) {
        setShowAddItemsOverlay(true);
        addItemsOverlayStartedAtRef.current = Date.now();
        addItemsOverlayActiveRef.current = true;
      }
    }
    setIsAddingItems(true);
    setAddItemsProgress({ status: 'scanning', count: 0, elapsedMs: 0, total: null, message: 'Scanning…' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let processed = 0;
    let lastUpdate = 0;

    const updateProgress = (delta: number) => {
      processed += delta;
      const now = Date.now();
      if (now - lastUpdate < 120) return;
      lastUpdate = now;
      setAddItemsProgress((prev) => ({
        ...prev,
        count: processed,
        elapsedMs: now - startedAt,
      }));
    };

    const collectRecursive = async (rootPath: string) => {
      const queue = [rootPath];
      const visited = new Set<string>();
      const files: SourceEntry[] = [];
      const maxConcurrent = 3;
      const pending = new Set<Promise<void>>();

      const processPath = async (path: string) => {
        if (!path || visited.has(path)) return;
        visited.add(path);
        const entries = await source.listEntries(path);
        entries.forEach((entry) => {
          if (entry.type === 'dir') {
            queue.push(entry.path);
          } else {
            files.push(entry);
          }
        });
        updateProgress(entries.filter((entry) => entry.type === 'file').length);
      };

      while (queue.length || pending.size) {
        while (queue.length && pending.size < maxConcurrent) {
          const nextPath = queue.shift();
          if (!nextPath) continue;
          const job = processPath(nextPath).finally(() => pending.delete(job));
          pending.add(job);
        }
        if (pending.size) {
          await Promise.race(pending);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      return files;
    };

    try {
      const selectedFiles: SourceEntry[] = [];
      const listingCache = new Map<string, SourceEntry[]>();
      const resolveSelectionEntry = async (filePath: string) => {
        const parent = getParentPath(filePath);
        if (!listingCache.has(parent)) {
          try {
            listingCache.set(parent, await source.listEntries(parent));
          } catch {
            listingCache.set(parent, []);
          }
        }
        const entries = listingCache.get(parent) ?? [];
        return entries.find(
          (entry) => entry.type === 'file' && normalizeSourcePath(entry.path) === normalizeSourcePath(filePath),
        ) ?? null;
      };
      for (const selection of selections) {
        if (selection.type === 'dir') {
          if (recurseFolders) {
            const nested = await collectRecursive(selection.path);
            selectedFiles.push(...nested);
          } else {
            const entries = await source.listEntries(selection.path);
            const files = entries.filter((entry) => entry.type === 'file');
            selectedFiles.push(...files);
            updateProgress(files.length);
          }
        } else {
          const normalizedPath = normalizeSourcePath(selection.path);
          const meta = await resolveSelectionEntry(normalizedPath);
          selectedFiles.push({
            type: 'file',
            name: meta?.name ?? selection.name,
            path: normalizedPath,
            sizeBytes: meta?.sizeBytes ?? null,
            modifiedAt: meta?.modifiedAt ?? null,
          });
          updateProgress(1);
        }
      }

      const playlistItems: PlaylistItem[] = [];
      let discoveredSonglengths: Array<{ path: string; file: LocalPlayFile }> | undefined;
      if (source.type === 'local') {
        const treeUri = localSourceTreeUris.get(source.id);
        const entriesMap = localEntriesBySourceId.get(source.id);
        const knownSonglengths = new Set(songlengthsFiles.map((entry) => entry.path));
        const discovered: Array<{ path: string; file: LocalPlayFile }> = [];
        const addSonglengthsEntry = (path: string, file?: LocalPlayFile) => {
          if (!file) return;
          const normalizedPath = normalizeSourcePath(path);
          if (knownSonglengths.has(normalizedPath)) return;
          knownSonglengths.add(normalizedPath);
          discovered.push({ path: normalizedPath, file });
        };
        const resolveSonglengthsFile = (entryPath: string, entryName: string, modifiedAt?: string | null) => {
          const normalizedPath = normalizeSourcePath(entryPath);
          const lastModified = parseModifiedAt(modifiedAt);
          const entry = entriesMap?.get(normalizedPath);
          return resolveLocalRuntimeFile(source.id, normalizedPath)
            || (entry?.uri
              ? buildLocalPlayFileFromUri(entryName, normalizedPath, entry.uri, lastModified)
              : undefined)
            || (treeUri
              ? buildLocalPlayFileFromTree(entryName, normalizedPath, treeUri, lastModified)
              : undefined);
        };

        selectedFiles
          .filter((entry) => entry.type === 'file' && isSonglengthsFileName(entry.name))
          .forEach((entry) => {
            const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt);
            addSonglengthsEntry(entry.path, file);
          });

        const directorySelections = selections.filter((selection) => selection.type === 'dir');
        for (const selection of directorySelections) {
          try {
            const recursiveEntries = await source.listFilesRecursive(selection.path);
            recursiveEntries
              .filter((entry) => entry.type === 'file' && isSonglengthsFileName(entry.name))
              .forEach((entry) => {
                const file = resolveSonglengthsFile(entry.path, entry.name, entry.modifiedAt);
                addSonglengthsEntry(entry.path, file);
              });
          } catch {
            // Ignore recursive scan failures.
          }
        }

        const sidPaths = selectedFiles
          .filter((entry) => getPlayCategory(entry.path) === 'sid')
          .map((entry) => entry.path);
        const candidatePaths = collectSonglengthsSearchPaths(sidPaths).filter((path) => !knownSonglengths.has(path));
        if (candidatePaths.length) {
          if (treeUri) {
            const foldersToScan = new Set(candidatePaths.map((path) => {
              const trimmed = path.replace(/\/[^/]+$/, '/');
              return normalizeSourcePath(trimmed || '/');
            }));
            for (const folder of foldersToScan) {
              try {
                const entries = await source.listEntries(folder);
                const songEntry = entries.find(
                  (entry) => entry.type === 'file' && isSonglengthsFileName(entry.name),
                );
                if (!songEntry) continue;
                const songPath = normalizeSourcePath(songEntry.path);
                addSonglengthsEntry(
                  songPath,
                  resolveSonglengthsFile(songEntry.path, songEntry.name, songEntry.modifiedAt),
                );
              } catch {
                // Ignore missing folders or SAF errors.
              }
            }
          } else if (entriesMap) {
            candidatePaths.forEach((candidate) => {
              const entry = entriesMap.get(candidate);
              if (!entry) return;
              const file = resolveSonglengthsFile(candidate, entry.name, entry.modifiedAt);
              addSonglengthsEntry(candidate, file);
            });
          }
        }

        if (discovered.length) {
          discoveredSonglengths = discovered;
          setSonglengthsFiles((prev) => {
            const seen = new Set(prev.map((entry) => entry.path));
            const next = [...prev];
            discovered.forEach((entry) => {
              if (seen.has(entry.path)) return;
              seen.add(entry.path);
              next.push(entry);
            });
            return next;
          });
        }
      }
      selectedFiles.forEach((file) => {
        if (!getPlayCategory(file.path)) return;
        const normalizedPath = normalizeSourcePath(file.path);
        const localEntry = source.type === 'local' ? localEntriesBySourceId.get(source.id)?.get(normalizedPath) : null;
        const entryModified = localEntry?.modifiedAt ? parseModifiedAt(localEntry.modifiedAt) : parseModifiedAt(file.modifiedAt);
        const localFile =
          source.type === 'local'
            ? resolveLocalRuntimeFile(source.id, normalizedPath)
              || (localEntry?.uri ? buildLocalPlayFileFromUri(localEntry.name, normalizedPath, localEntry.uri, entryModified) : undefined)
              || (localTreeUri ? buildLocalPlayFileFromTree(file.name, normalizedPath, localTreeUri, entryModified) : undefined)
            : undefined;
        const playable: PlayableEntry = {
          source: source.type === 'ultimate' ? 'ultimate' : 'local',
          name: file.name,
          path: normalizedPath,
          durationMs: undefined,
          sourceId: source.type === 'local' ? source.id : null,
          file: localFile,
          sizeBytes: file.sizeBytes ?? localEntry?.sizeBytes ?? null,
          modifiedAt: file.modifiedAt ?? localEntry?.modifiedAt ?? null,
        };
        const item = buildPlaylistItem(playable);
        if (item) playlistItems.push(item);
      });

      if (!playlistItems.length) {
        const reason = selectedFiles.length === 0 ? 'no-files-found' : 'unsupported-files';
        addLog('debug', 'No supported files after scan', {
          sourceId: source.id,
          sourceType: source.type,
          reason,
          totalFiles: selectedFiles.length,
        });
        toast({ title: 'No supported files', description: 'Found no supported files.', variant: 'destructive' });
        setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'No supported files found.' }));
        return false;
      }

      const minDuration = addItemsSurface === 'page' ? 800 : 300;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minDuration) {
        await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
      }
      const resolvedItems = await applySonglengthsToItems(playlistItems, discoveredSonglengths);
      setPlaylist((prev) => [...prev, ...resolvedItems]);
      if (localTreeUri) {
        addLog('debug', 'SAF scan complete', {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          totalFiles: selectedFiles.length,
          supportedFiles: playlistItems.length,
          elapsedMs: Date.now() - startedAt,
        });
      }
      toast({ title: 'Items added', description: `${playlistItems.length} file(s) added to playlist.` });
      setAddItemsProgress((prev) => ({ ...prev, status: 'done', message: 'Added to playlist' }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      return true;
    } catch (error) {
      const err = error as Error;
      const listingDetails = err instanceof LocalSourceListingError ? err.details : undefined;
      if (localTreeUri) {
        addLog('debug', 'SAF scan failed', {
          sourceId: source.id,
          treeUri: redactTreeUri(localTreeUri),
          error: err.message,
        });
      }
      addErrorLog('Add items failed', {
        sourceId: source.id,
        sourceType: source.type,
        platform: getPlatform(),
        treeUri: localTreeUri ? redactTreeUri(localTreeUri) : null,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
        details: listingDetails,
      });
      setAddItemsProgress((prev) => ({ ...prev, status: 'error', message: 'Add items failed' }));
      toast({ title: 'Add items failed', description: err.message, variant: 'destructive' });
      return false;
    } finally {
      setIsAddingItems(false);
      if (addItemsStartedAtRef.current) {
        setAddItemsProgress((prev) => ({
          ...prev,
          elapsedMs: Date.now() - addItemsStartedAtRef.current!,
        }));
      }
      if (addItemsOverlayActiveRef.current) {
        const overlayStartedAt = addItemsOverlayStartedAtRef.current ?? startedAt;
        const minOverlayDuration = 800;
        const overlayElapsed = Date.now() - overlayStartedAt;
        if (overlayElapsed < minOverlayDuration) {
          await new Promise((resolve) => setTimeout(resolve, minOverlayDuration - overlayElapsed));
        }
        setShowAddItemsOverlay(false);
        addItemsOverlayStartedAtRef.current = null;
        addItemsOverlayActiveRef.current = false;
      }
    }
  }, [
    addItemsSurface,
    applySonglengthsToItems,
    browserOpen,
    buildPlaylistItem,
    localEntriesBySourceId,
    localSourceTreeUris,
    recurseFolders,
    songlengthsFiles,
  ]);


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
      const now = new Date().toISOString();
      const lastStage = hvscLastStageRef.current;
      if (event.stage && event.stage !== 'error') {
        hvscLastStageRef.current = event.stage;
      }
      if (event.message) setHvscActionLabel(event.message);
      if (event.stage) setHvscStage(event.stage);
      if (typeof event.percent === 'number') setHvscProgress(event.percent);
      if (event.currentFile) setHvscCurrentFile(event.currentFile);
      if (event.errorCause) setHvscErrorMessage(event.errorCause);
      if (event.stage === 'download') {
        updateHvscSummary((prev) => ({
          ...prev,
          download: {
            ...prev.download,
            status: 'in-progress',
            startedAt: prev.download.startedAt ?? now,
            durationMs: event.elapsedTimeMs ?? prev.download.durationMs ?? null,
            sizeBytes: event.totalBytes ?? event.downloadedBytes ?? prev.download.sizeBytes ?? null,
            errorCategory: null,
            errorMessage: null,
          },
        }));
      }
      if (
        event.stage === 'archive_extraction' ||
        event.stage === 'archive_validation' ||
        event.stage === 'sid_enumeration' ||
        event.stage === 'songlengths' ||
        event.stage === 'sid_metadata_parsing'
      ) {
        updateHvscSummary((prev) => ({
          ...prev,
          extraction: {
            ...prev.extraction,
            status: 'in-progress',
            startedAt: prev.extraction.startedAt ?? now,
            durationMs: event.elapsedTimeMs ?? prev.extraction.durationMs ?? null,
            filesExtracted: event.processedCount ?? prev.extraction.filesExtracted ?? null,
            errorCategory: null,
            errorMessage: null,
          },
        }));
      }
      if (event.stage === 'complete') {
        updateHvscSummary((prev) => ({
          ...prev,
          download: {
            ...prev.download,
            status: prev.download.status === 'success' ? prev.download.status : 'success',
            finishedAt: prev.download.finishedAt ?? now,
          },
          extraction: {
            ...prev.extraction,
            status: prev.extraction.status === 'success' ? prev.extraction.status : 'success',
            finishedAt: prev.extraction.finishedAt ?? now,
          },
          lastUpdatedAt: now,
        }));
      }
      if (event.stage === 'error') {
        const category = resolveHvscFailureCategory(event, lastStage);
        const errorMessage = event.errorCause ?? event.message ?? null;
        updateHvscSummary((prev) => {
          if (lastStage === 'download') {
            return {
              ...prev,
              download: {
                ...prev.download,
                status: 'failure',
                finishedAt: now,
                errorCategory: category,
                errorMessage,
              },
              lastUpdatedAt: now,
            };
          }
          return {
            ...prev,
            extraction: {
              ...prev.extraction,
              status: 'failure',
              finishedAt: now,
              errorCategory: category,
              errorMessage,
            },
            lastUpdatedAt: now,
          };
        });
      }
      if (event.stage === 'songlengths') {
        addLog('info', 'HVSC songlengths source loaded', {
          message: event.message,
          archiveName: event.archiveName,
        });
      }
    }).then((handler) => {
      removeListener = handler.remove;
    });
    return () => {
      if (removeListener) void removeListener();
    };
  }, [resolveHvscFailureCategory, updateHvscSummary]);

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
    if (!isPlaying || isPaused || currentIndex < 0) return;
    const tick = () => {
      const now = Date.now();
      if (trackStartedAtRef.current) {
        setElapsedMs(now - trackStartedAtRef.current);
      }
      setPlayedMs(playedClockRef.current.current(now));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [currentIndex, isPaused, isPlaying]);

  const durationFallbackMs = durationSeconds * 1000;

  const resolveSidMetadata = useCallback(
    async (file?: LocalPlayFile) => {
      if (!file) return { durationMs: undefined, subsongCount: undefined } as const;
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch {
        return { durationMs: durationFallbackMs, subsongCount: undefined } as const;
      }
      const subsongCount = getSidSongCount(buffer);
      try {
        const filePath = getLocalFilePath(file);
        const songlengths = await loadSonglengthsForPath(filePath);
        if (songlengths?.pathToSeconds.has(filePath)) {
          const seconds = songlengths.pathToSeconds.get(filePath);
          const durationMs = seconds !== undefined && seconds !== null ? seconds * 1000 : durationFallbackMs;
          return { durationMs, subsongCount } as const;
        }

        const md5 = await computeSidMd5(buffer);
        const md5Duration = songlengths?.md5ToSeconds.get(md5);
        if (md5Duration !== undefined && md5Duration !== null) {
          return { durationMs: md5Duration * 1000, subsongCount } as const;
        }
        const seconds = await getHvscDurationByMd5Seconds(md5);
        const durationMs = seconds !== undefined && seconds !== null ? seconds * 1000 : durationFallbackMs;
        return { durationMs, subsongCount } as const;
      } catch {
        return { durationMs: durationFallbackMs, subsongCount } as const;
      }
    },
    [durationFallbackMs, loadSonglengthsForPath],
  );

  const playItem = useCallback(
    async (item: PlaylistItem, options?: { rebootBeforePlay?: boolean }) => {
      const api = getC64API();
      if (item.request.source === 'local' && !item.request.file) {
        throw new Error('Local file unavailable. Re-add it to the playlist.');
      }
      let durationOverride: number | undefined;
      let subsongCount: number | undefined;
      if (item.category === 'sid' && item.request.source === 'local') {
        const metadata = await resolveSidMetadata(item.request.file);
        durationOverride = metadata.durationMs;
        subsongCount = metadata.subsongCount;
      }
      if (isSongCategory(item.category)) {
        setCurrentSubsongCount(subsongCount ?? item.subsongCount ?? null);
      } else {
        setCurrentSubsongCount(null);
      }
      const request: PlayRequest = durationOverride
        ? { ...item.request, durationMs: durationOverride }
        : item.request;
      const plan = buildPlayPlan(request);
      const shouldReboot = options?.rebootBeforePlay ?? item.category === 'disk';
      const executionOptions = shouldReboot ? { rebootBeforeMount: true } : undefined;
      const resolvedDurationBase = durationOverride ?? item.durationMs;
      const resolvedDuration = isSongCategory(item.category)
        ? resolvedDurationBase ?? durationFallbackMs
        : resolvedDurationBase;
      setElapsedMs(0);
      setDurationMs(resolvedDuration);
      await executePlayPlan(api, plan, executionOptions);
      const now = Date.now();
      trackStartedAtRef.current = now;
      playedClockRef.current.start(now, true);
      setPlayedMs(playedClockRef.current.current(now));
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
      setIsPaused(false);
    },
    [durationFallbackMs, resolveSidMetadata],
  );

  const playlistItemDuration = useCallback(
    (item: PlaylistItem, index: number) => {
      const base = index === currentIndex ? durationMs ?? item.durationMs : item.durationMs;
      if (isSongCategory(item.category)) {
        return base ?? durationFallbackMs;
      }
      return base;
    },
    [currentIndex, durationFallbackMs, durationMs],
  );

  const currentItem = playlist[currentIndex];
  const currentDurationMs = currentItem ? playlistItemDuration(currentItem, currentIndex) : undefined;
  const currentDurationLabel = currentDurationMs !== undefined ? formatTime(currentDurationMs) : null;
  const progressPercent = currentDurationMs ? Math.min(100, (elapsedMs / currentDurationMs) * 100) : 0;
  const remainingMs = currentDurationMs !== undefined ? Math.max(0, currentDurationMs - elapsedMs) : undefined;
  const remainingLabel = currentDurationMs !== undefined ? `-${formatTime(remainingMs)}` : '—';
  const canControlVolume = enabledSidVolumeItems.length > 0 && volumeOptions.length > 0;
  const volumeLabel = volumeOptions[volumeIndex]?.label ?? '—';
  const knownSubsongCount = currentSubsongCount ?? (typeof currentItem?.subsongCount === 'number' ? currentItem.subsongCount : null);
  const subsongCount = knownSubsongCount ?? 1;
  const currentSongNr = currentItem?.request.songNr ?? 1;
  const clampedSongNr = Math.min(Math.max(1, currentSongNr), subsongCount);
  const isSongPlaying = Boolean(currentItem && isSongCategory(currentItem.category) && (isPlaying || isPaused));
  const songSelectorVisible = Boolean(isSongPlaying && knownSubsongCount && knownSubsongCount > 1);

  const handleSongSelection = useCallback(async (nextSongNr: number) => {
    if (!currentItem || !isSongCategory(currentItem.category)) return;
    const capped = knownSubsongCount ? Math.min(Math.max(1, nextSongNr), knownSubsongCount) : Math.max(1, nextSongNr);
    const nextItem = {
      ...currentItem,
      request: { ...currentItem.request, songNr: capped },
    };
    setSongNrInput(String(capped));
    setSongPickerOpen(false);
    setIsPlaylistLoading(true);
    try {
      await playItem(nextItem);
      setPlaylist((prev) => prev.map((item, index) => (index === currentIndex ? nextItem : item)));
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [currentIndex, currentItem, knownSubsongCount, playItem]);

  useEffect(() => {
    if (!isSongPlaying && songPickerOpen) {
      setSongPickerOpen(false);
    }
  }, [isSongPlaying, songPickerOpen]);
  const playlistIds = useMemo(() => playlist.map((item) => item.id), [playlist]);
  const selectedPlaylistCount = selectedPlaylistIds.size;
  const allPlaylistSelected = selectedPlaylistCount > 0 && selectedPlaylistCount === playlistIds.length;
  const hasPlaylist = playlist.length > 0;
  const canTransport = hasPlaylist && !isPlaylistLoading;
  const canPause = isPlaying;
  const hasPrev = currentIndex > 0;
  const hasNext = hasPlaylist && (currentIndex < playlist.length - 1 || repeatEnabled);

  const toggleShuffleCategory = (category: PlayFileCategory) => {
    setShuffleCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category],
    );
  };


  const handlePlaylistSelect = useCallback((item: PlaylistItem, selected: boolean) => {
    setSelectedPlaylistIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });
  }, []);

  const toggleSelectAllPlaylist = useCallback(() => {
    setSelectedPlaylistIds(allPlaylistSelected ? new Set() : new Set(playlistIds));
  }, [allPlaylistSelected, playlistIds]);

  const removePlaylistItemsById = useCallback((ids: Set<string>) => {
    if (!ids.size) return;
    setPlaylist((prev) => {
      const next = prev.filter((item) => !ids.has(item.id));
      const currentId = prev[currentIndex]?.id;
      if (currentId && ids.has(currentId)) {
        setIsPlaying(false);
        setIsPaused(false);
        setElapsedMs(0);
        setDurationMs(undefined);
        trackStartedAtRef.current = null;
      }
      setCurrentIndex((prevIndex) => {
        if (prevIndex < 0) return prevIndex;
        if (!currentId) return -1;
        return next.findIndex((entry) => entry.id === currentId);
      });
      return next;
    });
    setSelectedPlaylistIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set(Array.from(prev).filter((id) => !ids.has(id)));
      return next;
    });
  }, [currentIndex]);

  const handleRemoveSelectedPlaylist = useCallback(() => {
    if (!selectedPlaylistIds.size) return;
    removePlaylistItemsById(new Set(selectedPlaylistIds));
  }, [removePlaylistItemsById, selectedPlaylistIds]);

  const hydrateStoredPlaylist = useCallback((stored: StoredPlaylistState | null) => {
    if (!stored?.items?.length) return { items: [] as PlaylistItem[], index: -1 };
    const hydrated = stored.items
      .map((entry) => {
        const normalizedPath = normalizeSourcePath(entry.path);
        const localEntry = entry.source === 'local' && entry.sourceId
          ? localEntriesBySourceId.get(entry.sourceId)?.get(normalizedPath)
          : null;
        const localTreeUri = entry.source === 'local' && entry.sourceId
          ? localSourceTreeUris.get(entry.sourceId)
          : null;
        const playable: PlayableEntry = {
          source: entry.source,
          name: entry.name,
          path: entry.path,
          durationMs: entry.durationMs,
          sourceId: entry.sourceId ?? null,
          file: entry.source === 'local'
            ? resolveLocalRuntimeFile(entry.sourceId ?? '', normalizedPath)
              || (localEntry?.uri
                ? buildLocalPlayFileFromUri(entry.name, normalizedPath, localEntry.uri, parseModifiedAt(localEntry.modifiedAt))
                : undefined)
              || (localTreeUri
                ? buildLocalPlayFileFromTree(entry.name, normalizedPath, localTreeUri, parseModifiedAt(localEntry?.modifiedAt))
                : undefined)
            : undefined,
          sizeBytes: localEntry?.sizeBytes ?? entry.sizeBytes ?? null,
          modifiedAt: localEntry?.modifiedAt ?? entry.modifiedAt ?? null,
        };
        return buildPlaylistItem(playable, entry.songNr, entry.addedAt ?? null);
      })
      .filter((item): item is PlaylistItem => Boolean(item));
    return { items: hydrated, index: stored.currentIndex ?? -1 };
  }, [buildPlaylistItem, localEntriesBySourceId, localSourceTreeUris]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      let raw = localStorage.getItem(playlistStorageKey);
      if (!raw && uniqueId !== 'default') {
        raw = localStorage.getItem(buildPlaylistStorageKey('default'));
      }
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredPlaylistState;
      const restored = hydrateStoredPlaylist(parsed);
      setPlaylist(restored.items);
      setCurrentIndex(restored.index);
    } catch {
      // Ignore invalid stored playlists.
    }
  }, [hydrateStoredPlaylist, playlistStorageKey, uniqueId]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const stored: StoredPlaylistState = {
      items: playlist.map((item) => ({
        source: item.request.source,
        path: item.path,
        name: item.label,
        durationMs: item.durationMs,
        songNr: item.request.songNr,
        sourceId: item.sourceId ?? null,
        sizeBytes: item.sizeBytes ?? null,
        modifiedAt: item.modifiedAt ?? null,
        addedAt: item.addedAt ?? null,
      })),
      currentIndex,
    };
    try {
      localStorage.setItem(playlistStorageKey, JSON.stringify(stored));
    } catch {
      // Ignore storage failures.
    }
  }, [currentIndex, playlist, playlistStorageKey]);

  const startPlaylist = useCallback(async (items: PlaylistItem[], startIndex = 0) => {
    if (!items.length) return;
    playedClockRef.current.reset();
    setPlayedMs(0);
    const resolvedItems = await applySonglengthsToItems(items);
    setPlaylist((prev) => {
      if (!prev.length) return resolvedItems;
      const baseIds = new Set(resolvedItems.map((item) => item.id));
      const extras = prev.filter((item) => !baseIds.has(item.id));
      return extras.length ? [...resolvedItems, ...extras] : resolvedItems;
    });
    setCurrentIndex(startIndex);
    setIsPlaylistLoading(true);
    setIsPaused(false);
    try {
      await playItem(resolvedItems[startIndex]);
    } catch (error) {
      addErrorLog('Playlist playback failed', {
        error: (error as Error).message,
        item: resolvedItems[startIndex]?.label,
      });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
      setIsPlaying(false);
      setIsPaused(false);
      trackStartedAtRef.current = null;
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [applySonglengthsToItems, playItem]);

  const handlePlay = useCallback(async () => {
    if (!playlist.length) return;
    try {
      if (currentIndex < 0) {
        await startPlaylist(playlist, 0);
        return;
      }
      await playItem(playlist[currentIndex]);
    } catch (error) {
      addErrorLog('Play action failed', {
        error: (error as Error).message,
        item: playlist[currentIndex]?.label,
      });
      toast({
        title: 'Playback failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [currentIndex, playItem, playlist, startPlaylist]);

  const handleStop = useCallback(async () => {
    if (!isPlaying && !isPaused) return;
    const currentItem = playlist[currentIndex];
    const shouldReboot = currentItem?.category === 'disk';
    try {
      const api = getC64API();
      if (shouldReboot) {
        await api.machineReboot();
      } else {
        await api.machineReset();
      }
    } catch (error) {
      addErrorLog('Stop failed', { error: (error as Error).message });
    }
    const now = Date.now();
    playedClockRef.current.stop(now, true);
    setPlayedMs(0);
    setIsPlaying(false);
    setIsPaused(false);
    setElapsedMs(0);
    setDurationMs(undefined);
    setCurrentSubsongCount(null);
    trackStartedAtRef.current = null;
  }, [currentIndex, isPaused, isPlaying, playlist]);

  const handlePauseResume = useCallback(async () => {
    if (!isPlaying) return;
    const api = getC64API();
    try {
      if (isPaused) {
        const resumeItems = await resolveSidVolumeItems();
        const resumeSnapshot = pauseMuteSnapshotRef.current;
        const wasMuted = resumeSnapshot && resumeItems.length
          ? resumeItems.every((item) => resumeSnapshot[item.name] === resolveAudioMixerMuteValue(item.options))
          : false;
        if (pauseMuteSnapshotRef.current && resumeItems.length) {
          await applyAudioMixerUpdates(pauseMuteSnapshotRef.current, 'Resume');
        }
        await api.machineResume();
        pauseMuteSnapshotRef.current = null;
        setIsPaused(false);
        setVolumeMuted(wasMuted);
        const now = Date.now();
        trackStartedAtRef.current = now - elapsedMs;
        playedClockRef.current.resume(now);
        setPlayedMs(playedClockRef.current.current(now));
      } else {
        const pauseItems = await resolveSidVolumeItems();
        if (pauseItems.length) {
          pauseMuteSnapshotRef.current = buildSidVolumeSnapshot(pauseItems);
        }
        await api.machinePause();
        if (pauseItems.length) {
          await applyAudioMixerUpdates(buildSidMuteUpdates(pauseItems), 'Pause');
          setVolumeMuted(true);
        }
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        setIsPaused(true);
      }
    } catch (error) {
      toast({
        title: 'Playback control failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [applyAudioMixerUpdates, buildSidMuteUpdates, buildSidVolumeSnapshot, elapsedMs, isPaused, isPlaying, resolveSidVolumeItems]);

  const handleVolumeChange = useCallback((value: number[]) => {
    const nextIndex = value[0] ?? 0;
    setVolumeIndex(nextIndex);
    if (volumeMuted) {
      setVolumeMuted(false);
    }
  }, [volumeMuted]);

  const handleVolumeCommit = useCallback(async (nextIndex: number) => {
    if (!volumeOptions.length || !sidVolumeItems.length) return;
    const target = volumeOptions[nextIndex]?.option;
    if (!target) return;
    const updates = buildEnabledSidVolumeUpdates(sidVolumeItems, sidEnablement, target);
    manualMuteSnapshotRef.current = null;
    await applyAudioMixerUpdates(updates, 'Volume');
    setVolumeMuted(false);
  }, [applyAudioMixerUpdates, sidEnablement, sidVolumeItems, volumeOptions]);

  const handleVolumeInteraction = useCallback(() => {
    if (!volumeMuted) return;
    setVolumeMuted(false);
    manualMuteSnapshotRef.current = null;
    void handleVolumeCommit(volumeIndex);
  }, [handleVolumeCommit, volumeIndex, volumeMuted]);

  const handleToggleMute = useCallback(async () => {
    const items = await resolveEnabledSidVolumeItems(true);
    if (!items.length) return;
    if (!volumeMuted) {
      manualMuteSnapshotRef.current = buildEnabledSidVolumeSnapshot(items, sidEnablement);
      setVolumeMuted(true);
      await applyAudioMixerUpdates(buildEnabledSidMuteUpdates(items, sidEnablement), 'Mute');
      return;
    }
    const snapshot = manualMuteSnapshotRef.current;
    const target = volumeOptions[volumeIndex]?.option ?? null;
    const updates = buildEnabledSidRestoreUpdates(items, sidEnablement, snapshot, target);
    if (Object.keys(updates).length) {
      await applyAudioMixerUpdates(updates, 'Unmute');
    }
    setVolumeMuted(false);
    manualMuteSnapshotRef.current = null;
  }, [
    applyAudioMixerUpdates,
    buildEnabledSidRestoreUpdates,
    buildEnabledSidVolumeSnapshot,
    resolveEnabledSidVolumeItems,
    sidEnablement,
    volumeIndex,
    volumeOptions,
    volumeMuted,
  ]);

  const handleDurationSliderChange = useCallback((value: number[]) => {
    const nextSeconds = sliderToDurationSeconds(value[0] ?? 0);
    setDurationSeconds(nextSeconds);
    setDurationInput(formatDurationSeconds(nextSeconds));
  }, []);

  const handleDurationInputChange = useCallback((value: string) => {
    setDurationInput(value);
    const parsed = parseDurationInput(value);
    if (parsed === undefined) return;
    const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
    setDurationSeconds(nextSeconds);
  }, []);

  const handleDurationInputBlur = useCallback(() => {
    const parsed = parseDurationInput(durationInput);
    if (parsed === undefined) {
      setDurationInput(formatDurationSeconds(durationSeconds));
      return;
    }
    const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
    if (nextSeconds !== durationSeconds) {
      setDurationSeconds(nextSeconds);
    }
    setDurationInput(formatDurationSeconds(nextSeconds));
  }, [durationInput, durationSeconds]);


  const handleNext = useCallback(async () => {
    if (!playlist.length) return;
    const now = Date.now();
    playedClockRef.current.pause(now);
    setPlayedMs(playedClockRef.current.current(now));
    const currentItem = playlist[currentIndex];
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (!repeatEnabled) {
        playedClockRef.current.pause(Date.now());
        setIsPlaying(false);
        return;
      }
      nextIndex = 0;
    }
    setCurrentIndex(nextIndex);
    const nextItem = playlist[nextIndex];
    const shouldReboot = currentItem?.category === 'disk' || nextItem?.category === 'disk';
    await playItem(nextItem, { rebootBeforePlay: shouldReboot });
    setIsPaused(false);
  }, [currentIndex, playItem, playlist, repeatEnabled]);

  const handlePrevious = useCallback(async () => {
    if (!playlist.length) return;
    const now = Date.now();
    playedClockRef.current.pause(now);
    setPlayedMs(playedClockRef.current.current(now));
    const currentItem = playlist[currentIndex];
    const prevIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(prevIndex);
    const prevItem = playlist[prevIndex];
    const shouldReboot = currentItem?.category === 'disk' || prevItem?.category === 'disk';
    await playItem(prevItem, { rebootBeforePlay: shouldReboot });
    setIsPaused(false);
  }, [currentIndex, playItem, playlist]);

  useEffect(() => {
    if (!isPlaying || currentDurationMs === undefined) return;
    if (elapsedMs >= currentDurationMs) {
      void handleNext();
    }
  }, [currentDurationMs, elapsedMs, handleNext, isPlaying]);

  const reshufflePlaylist = useCallback((items: PlaylistItem[], lockedIndex: number) => {
    if (items.length < 2) return items;
    if (lockedIndex >= 0 && lockedIndex < items.length) {
      const currentItem = items[lockedIndex];
      const rest = items.filter((_, index) => index !== lockedIndex);
      const shuffled = shuffleArray(rest);
      const insertIndex = Math.min(lockedIndex, shuffled.length);
      let next = [...shuffled.slice(0, insertIndex), currentItem, ...shuffled.slice(insertIndex)];
      if (next.map((item) => item.id).join('|') === items.map((item) => item.id).join('|')) {
        if (rest.length > 1) {
          const swapped = [...shuffled];
          [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
          next = [...swapped.slice(0, insertIndex), currentItem, ...swapped.slice(insertIndex)];
        }
      }
      return next;
    }

    let shuffled = shuffleArray(items);
    if (shuffled.map((item) => item.id).join('|') === items.map((item) => item.id).join('|')) {
      if (shuffled.length > 1) {
        const swapped = [...shuffled];
        [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
        shuffled = swapped;
      }
    }
    return shuffled;
  }, []);

  const handleReshuffle = useCallback(() => {
    if (!shuffleEnabled || !playlist.length) return;
    setPlaylist((prev) => reshufflePlaylist(prev, currentIndex));
  }, [currentIndex, playlist.length, reshufflePlaylist, shuffleEnabled]);


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


  const handleHvscInstall = useCallback(async () => {
    try {
      const startedAt = new Date().toISOString();
      setHvscLoading(true);
      setHvscProgress(0);
      setHvscStage(null);
      setHvscErrorMessage(null);
      setHvscActionLabel('Checking for updates…');
      updateHvscSummary((prev) => ({
        ...prev,
        download: {
          ...prev.download,
          status: 'in-progress',
          startedAt,
          finishedAt: null,
          durationMs: null,
          errorCategory: null,
          errorMessage: null,
        },
        extraction: {
          ...prev.extraction,
          status: prev.extraction.status === 'success' ? prev.extraction.status : 'idle',
          errorCategory: null,
          errorMessage: null,
        },
      }));
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
      const finishedAt = new Date().toISOString();
      updateHvscSummary((prev) => ({
        ...prev,
        download: {
          ...prev.download,
          status: 'success',
          finishedAt,
          errorCategory: null,
          errorMessage: null,
        },
        extraction: {
          ...prev.extraction,
          status: 'success',
          finishedAt,
          errorCategory: null,
          errorMessage: null,
        },
        lastUpdatedAt: finishedAt,
      }));
      toast({
        title: 'HVSC ready',
        description: `Version ${status.installedVersion} installed.`,
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      setHvscErrorMessage((error as Error).message);
      updateHvscSummary((prev) => ({
        ...prev,
        download: {
          ...prev.download,
          status: 'failure',
          finishedAt: failedAt,
          errorCategory: 'download',
          errorMessage: (error as Error).message,
        },
        lastUpdatedAt: failedAt,
      }));
      toast({
        title: 'HVSC update failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setHvscLoading(false);
    }
  }, [refreshHvscStatus, updateHvscSummary]);

  const handleHvscIngest = useCallback(async () => {
    try {
      const startedAt = new Date().toISOString();
      setHvscLoading(true);
      setHvscProgress(0);
      setHvscStage(null);
      setHvscErrorMessage(null);
      setHvscActionLabel('Ingesting cached HVSC…');
      updateHvscSummary((prev) => ({
        ...prev,
        extraction: {
          ...prev.extraction,
          status: 'in-progress',
          startedAt,
          finishedAt: null,
          durationMs: null,
          errorCategory: null,
          errorMessage: null,
        },
      }));
      await ingestCachedHvsc('hvsc-ingest');
      const status = await getHvscStatus();
      setHvscStatus(status);
      const finishedAt = new Date().toISOString();
      updateHvscSummary((prev) => ({
        ...prev,
        extraction: {
          ...prev.extraction,
          status: 'success',
          finishedAt,
          errorCategory: null,
          errorMessage: null,
        },
        lastUpdatedAt: finishedAt,
      }));
      toast({
        title: 'HVSC ready',
        description: `Version ${status.installedVersion} installed.`,
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      setHvscErrorMessage((error as Error).message);
      updateHvscSummary((prev) => ({
        ...prev,
        extraction: {
          ...prev.extraction,
          status: 'failure',
          finishedAt: failedAt,
          errorCategory: 'extraction',
          errorMessage: (error as Error).message,
        },
        lastUpdatedAt: failedAt,
      }));
      toast({
        title: 'HVSC ingest failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setHvscLoading(false);
    }
  }, [updateHvscSummary]);

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
        .map((entry) => buildPlaylistItem(entry))
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

  const playlistTotals = useMemo(() => {
    const durations = playlist.map((item, index) => playlistItemDuration(item, index));
    return calculatePlaylistTotals(durations, playedMs);
  }, [playlist, playedMs, playlistItemDuration]);

  const filteredPlaylist = useMemo(() => playlist, [playlist]);

  const playlistListItems = useMemo(() => {
    const items: ActionListItem[] = [];
    let lastFolder: string | null = null;
    filteredPlaylist.forEach((item, index) => {
      const folderPath = getParentPath(item.path);
      if (folderPath !== lastFolder) {
        items.push({
          id: `folder:${folderPath}`,
          title: folderPath,
          variant: 'header',
          icon: <Folder className="h-3.5 w-3.5" aria-hidden="true" />,
          selected: false,
          actionLabel: '',
          showMenu: false,
          showSelection: false,
          disableActions: true,
        });
        lastFolder = folderPath;
      }
      const playlistIndex = playlist.findIndex((entry) => entry.id === item.id);
      const durationLabel = formatTime(playlistItemDuration(item, Math.max(0, playlistIndex)));
      const sourceLabel = item.request.source === 'ultimate' ? 'C64 Ultimate' : 'This device';
      const detailsDate = item.modifiedAt ?? item.addedAt ?? null;
      const menuItems: ActionListMenuItem[] = [
        { type: 'label', label: 'Details' },
        { type: 'info', label: 'Type', value: formatPlayCategory(item.category) },
        { type: 'info', label: 'Duration', value: durationLabel },
        { type: 'info', label: 'Size', value: formatBytes(item.sizeBytes) },
        { type: 'info', label: 'Date', value: formatDate(detailsDate) },
        { type: 'info', label: 'Source', value: sourceLabel },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Remove from playlist',
          onSelect: () => removePlaylistItemsById(new Set([item.id])),
          destructive: true,
        },
      ];
      items.push({
        id: item.id,
        title: item.label,
        icon: (
          <FileOriginIcon
            origin={item.request.source === 'ultimate' ? 'ultimate' : 'local'}
            className="h-4 w-4 shrink-0 opacity-60"
          />
        ),
        titleSuffix: isSongCategory(item.category) && durationLabel !== '—' ? `(${durationLabel})` : null,
        selected: selectedPlaylistIds.has(item.id),
        onSelectToggle: (selected) => handlePlaylistSelect(item, selected),
        menuItems,
        actionLabel: 'Play',
        onAction: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        onTitleClick: () => void startPlaylist(playlist, Math.max(0, playlistIndex)),
        disableActions: isPlaylistLoading,
      } as ActionListItem);
    });
    return items;
  }, [filteredPlaylist, handlePlaylistSelect, isPlaylistLoading, playlist, playlistItemDuration, removePlaylistItemsById, selectedPlaylistIds, startPlaylist]);

  const hvscInstalled = Boolean(hvscStatus?.installedVersion);
  const hvscAvailable = isHvscBridgeAvailable();
  const hvscUpdating = hvscLoading || hvscStatus?.ingestionState === 'installing' || hvscStatus?.ingestionState === 'updating';
  const hvscInlineError = hvscErrorMessage || (hvscStatus?.ingestionState === 'error' ? hvscStatus.ingestionError : null);
  const hvscSummaryState = useMemo(() => {
    if (hvscStatusSummary.download.status === 'failure' || hvscStatusSummary.extraction.status === 'failure') return 'failure';
    if (hvscStatusSummary.download.status === 'success' || hvscStatusSummary.extraction.status === 'success') return 'success';
    return 'idle';
  }, [hvscStatusSummary]);
  const hvscSummaryFailureCategory = hvscStatusSummary.extraction.status === 'failure'
    ? hvscStatusSummary.extraction.errorCategory
    : hvscStatusSummary.download.errorCategory;
  const hvscSummaryFailureLabel = useMemo(() => {
    switch (hvscSummaryFailureCategory) {
      case 'network':
        return 'Network error';
      case 'storage':
        return 'Storage error';
      case 'download':
        return 'Download error';
      case 'extraction':
      case 'corrupt-archive':
      case 'unsupported-format':
        return 'Extraction error';
      default:
        return 'Download error';
    }
  }, [hvscSummaryFailureCategory]);
  const hvscSummaryDurationMs = hvscStatusSummary.extraction.durationMs ?? hvscStatusSummary.download.durationMs;
  const hvscSummaryFilesExtracted = hvscStatusSummary.extraction.filesExtracted;
  const hvscSummaryUpdatedAt = hvscStatusSummary.lastUpdatedAt;

  const hvscVisibleFolders = useMemo(() => {
    if (!hvscFolderFilter) return hvscFolders;
    return hvscFolders.filter((folder) => folder.toLowerCase().includes(hvscFolderFilter.toLowerCase()));
  }, [hvscFolders, hvscFolderFilter]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      <AppBar
        title="Play Files"
        subtitle={status.isConnected ? 'Connected' : status.isConnecting ? 'Connecting…' : 'Offline'}
      />
      <main className="container max-w-3xl mx-auto px-4 py-6 pb-24 space-y-6">
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-xs text-muted-foreground" data-testid="playback-current-track">
              {currentItem ? (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-sm font-medium text-foreground">{currentItem.label}</span>
                  {currentDurationLabel ? (
                    <span className="text-xs text-muted-foreground">({currentDurationLabel})</span>
                  ) : null}
                </div>
              ) : (
                'Select a playlist item to start'
              )}
            </div>
            <div className="flex flex-col gap-3 w-full sm:w-auto">
              <div className="grid grid-cols-4 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[96px] justify-center"
                  onClick={() => void handlePrevious()}
                  disabled={!canTransport || !hasPrev}
                  data-testid="playlist-prev"
                >
                  <SkipBack className="h-4 w-4 mr-1" />
                  Prev
                </Button>
                <Button
                  variant={isPlaying ? 'destructive' : 'default'}
                  size="sm"
                  className="min-w-[96px] justify-center"
                  onClick={() => (isPlaying ? void handleStop() : void handlePlay())}
                  disabled={!hasPlaylist || isPlaylistLoading}
                  data-testid="playlist-play"
                >
                  {isPlaying ? <Square className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                  {isPlaying ? 'Stop' : 'Play'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[96px] justify-center"
                  onClick={() => void handlePauseResume()}
                  disabled={!canPause || isPlaylistLoading}
                  data-testid="playlist-pause"
                >
                  {isPaused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[96px] justify-center"
                  onClick={() => void handleNext()}
                  disabled={!canTransport || !hasNext}
                  data-testid="playlist-next"
                >
                  <SkipForward className="h-4 w-4 mr-1" />
                  Next
                </Button>
              </div>
              <div className="space-y-2">
                <Progress value={progressPercent} className="w-full" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span data-testid="playback-elapsed">{formatTime(elapsedMs)}</span>
                  <span data-testid="playback-remaining">{remainingLabel}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground" data-testid="playback-counters">
                  <span>Total: {formatTime(playlistTotals.total)}</span>
                  <span>Remaining: {formatTime(playlistTotals.remaining)}</span>
                </div>
                <div className="text-xs text-muted-foreground text-right" data-testid="playback-played">
                  Played: {formatTime(playedMs)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[96px] justify-center"
                  onClick={() => void handleToggleMute()}
                  disabled={!canControlVolume || updateConfigBatch.isPending}
                  data-testid="volume-mute"
                >
                  {volumeMuted ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />}
                  {volumeMuted ? 'Unmute' : 'Mute'}
                </Button>
                <div className="flex flex-1 items-center gap-3 min-w-[160px] sm:min-w-[200px]">
                  <Slider
                    min={0}
                    max={Math.max(0, volumeOptions.length - 1)}
                    step={1}
                    value={[volumeIndex]}
                    onValueChange={handleVolumeChange}
                    onValueCommit={(value) => void handleVolumeCommit(value[0] ?? 0)}
                    onPointerDown={handleVolumeInteraction}
                    disabled={!canControlVolume || updateConfigBatch.isPending}
                    data-testid="volume-slider"
                  />
                  <span className="text-xs text-muted-foreground w-[52px] text-right">{volumeLabel}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={recurseFolders}
                    onCheckedChange={(value) => setRecurseFolders(Boolean(value))}
                    aria-label="Recurse"
                    data-testid="playback-recurse"
                  />
                  Recurse
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={shuffleEnabled}
                    onCheckedChange={(value) => setShuffleEnabled(Boolean(value))}
                    aria-label="Shuffle"
                    data-testid="playback-shuffle"
                  />
                  <span className="flex items-center gap-1"><Shuffle className="h-3.5 w-3.5" /> Shuffle</span>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={repeatEnabled}
                    onCheckedChange={(value) => setRepeatEnabled(Boolean(value))}
                    aria-label="Repeat"
                    data-testid="playback-repeat"
                  />
                  <span className="flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> Repeat</span>
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReshuffle}
                  disabled={!shuffleEnabled || playlist.length < 2}
                >
                  <Shuffle className="h-4 w-4 mr-1" />
                  Reshuffle
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Default duration</p>
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-1 min-w-[160px]">
                <Slider
                  min={0}
                  max={DURATION_SLIDER_STEPS}
                  step={1}
                  value={[durationSecondsToSlider(durationSeconds)]}
                  onValueChange={handleDurationSliderChange}
                  data-testid="duration-slider"
                />
              </div>
              <Input
                value={durationInput}
                onChange={(event) => handleDurationInputChange(event.target.value)}
                onBlur={handleDurationInputBlur}
                inputMode="numeric"
                placeholder="mm:ss"
                className="w-[84px] text-right"
                data-testid="duration-input"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Songlengths file</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => songlengthsInputRef.current?.click()}
              >
                Choose file
              </Button>
            </div>
            {activeSonglengthsPath ? (
              <button
                type="button"
                className="text-xs font-mono text-primary hover:underline text-left break-all"
                onClick={() => songlengthsInputRef.current?.click()}
              >
                {activeSonglengthsPath}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">Not found yet.</p>
            )}
          </div>

          <div className="space-y-3">
            {songSelectorVisible ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col gap-2 w-full max-w-full">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="song-selector-trigger"
                      data-open={songPickerOpen ? 'true' : 'false'}
                      onPointerDown={() => setSongPickerOpen(true)}
                      onClick={() => {
                        setSongNrInput(String(clampedSongNr));
                        setSongPickerOpen(true);
                      }}
                    >
                      Song {clampedSongNr}/{subsongCount}
                    </Button>
                  </div>
                </div>
                {songPickerOpen ? (
                  <div
                    role="dialog"
                    aria-label="SID song number"
                    data-testid="song-selector-dialog"
                    className="w-full max-w-full rounded-lg border border-border bg-background p-3 shadow-sm space-y-2"
                  >
                    <p className="text-sm font-semibold">SID song number</p>
                    <p className="text-xs text-muted-foreground">Select a subsong index to start playback.</p>
                    <div className="space-y-2" data-testid="song-selector-options">
                      {Array.from({ length: subsongCount }, (_, index) => {
                        const value = index + 1;
                        return (
                          <Button
                            key={value}
                            variant={value === clampedSongNr ? 'default' : 'outline'}
                            className="w-full justify-start"
                            onClick={() => void handleSongSelection(value)}
                          >
                            Song {value}
                          </Button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Available songs: 1–{subsongCount}
                    </p>
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setSongPickerOpen(false)}>
                      Close
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((category) => (
                <label key={category} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Checkbox
                    checked={shuffleCategories.includes(category)}
                    onCheckedChange={() => toggleShuffleCategory(category)}
                    disabled={!shuffleEnabled}
                    aria-label={formatPlayCategory(category)}
                    data-testid={`shuffle-category-${category}`}
                  />
                  {formatPlayCategory(category)}
                </label>
              ))}
            </div>
          </div>
        </div>

        <SelectableActionList
          title="Playlist"
          selectionLabel="items"
          items={playlistListItems}
          emptyLabel="No tracks in playlist yet."
          selectAllLabel="Select all"
          deselectAllLabel="Deselect all"
          removeSelectedLabel={selectedPlaylistCount ? 'Remove selected items' : undefined}
          selectedCount={selectedPlaylistCount}
          allSelected={allPlaylistSelected}
          onToggleSelectAll={toggleSelectAllPlaylist}
          onRemoveSelected={handleRemoveSelectedPlaylist}
          maxVisible={listPreviewLimit}
          viewAllTitle="Playlist"
          listTestId="playlist-list"
          rowTestId="playlist-item"
          headerActions={
            <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
              {hasPlaylist ? 'Add more items' : 'Add items'}
            </Button>
          }
        />

        <input
          ref={localSourceInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            handleLocalSourceInput(event.target.files);
            event.currentTarget.value = '';
          }}
        />

        <input
          ref={songlengthsInputRef}
          type="file"
          accept=".md5,.txt"
          className="hidden"
          onChange={(event) => {
            handleSonglengthsInput(event.target.files);
            event.currentTarget.value = '';
          }}
        />

        <ItemSelectionDialog
          open={browserOpen}
          onOpenChange={setBrowserOpen}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={sourceGroups}
          onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
          onConfirm={handleAddFileSelections}
          filterEntry={(entry) => entry.type === 'dir' || isSupportedPlayFile(entry.path)}
          allowFolderSelection
          isConfirming={isAddingItems}
          progress={addItemsProgress}
          showProgressFooter={addItemsSurface === 'dialog'}
          autoConfirmCloseBefore={isAndroid}
          onAutoConfirmStart={handleAutoConfirmStart}
          autoConfirmLocalSource
        />

        {!browserOpen ? (
          <AddItemsProgressOverlay
            progress={addItemsProgress}
            title="Adding items"
            testId="add-items-overlay"
            visible={showAddItemsOverlay || addItemsProgress.status === 'scanning'}
          />
        ) : null}

        {hvscControlsEnabled && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">HVSC library</p>
                <p className="text-xs text-muted-foreground">
                  {hvscInstalled
                    ? `Installed version ${hvscStatus?.installedVersion ?? '—'}`
                    : 'Download the HVSC library to browse the SID collection.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void handleHvscInstall()}
                  disabled={hvscUpdating || !hvscAvailable}
                  className="whitespace-normal"
                >
                  Download HVSC Library
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleHvscIngest()}
                  disabled={hvscUpdating || !hvscAvailable}
                  className="whitespace-normal"
                >
                  Ingest cached
                </Button>
              </div>
            </div>

            {hvscSummaryState !== 'idle' && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                {hvscSummaryState === 'success' ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">HVSC downloaded successfully</p>
                    <p>Files extracted: {hvscSummaryFilesExtracted ?? '—'}</p>
                    <p>Duration: {formatHvscDuration(hvscSummaryDurationMs)}</p>
                    <p>Last updated: {formatHvscTimestamp(hvscSummaryUpdatedAt)}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">HVSC download failed</p>
                    <p>{hvscSummaryFailureLabel}</p>
                  </div>
                )}
              </div>
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
                    <div key={folder} className="flex items-center gap-2 min-w-0">
                      <Button
                        variant={folder === selectedHvscFolder ? 'secondary' : 'outline'}
                        size="sm"
                        className="flex-1 justify-start min-w-0"
                        onClick={() => void loadHvscFolder(folder)}
                      >
                        <FolderOpen className="h-4 w-4 mr-1 shrink-0" />
                        <span className="truncate">{folder}</span>
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="shrink-0"
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

import { mergeAudioMixerOptions } from '@/lib/config/audioMixer';
import { normalizeConfigItem } from '@/lib/config/normalizeConfigItem';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import type { PlayFileCategory } from '@/lib/playback/fileTypes';

export type AudioMixerItem = {
  name: string;
  value: string | number;
  options?: string[];
};

export const CATEGORY_OPTIONS: PlayFileCategory[] = ['sid', 'mod', 'prg', 'crt', 'disk'];
export const buildPlaylistStorageKey = (deviceId: string) => `c64u_playlist:v1:${deviceId}`;
export const LAST_DEVICE_ID_KEY = 'c64u_last_device_id';
export const PLAYLIST_STORAGE_PREFIX = 'c64u_playlist:v1:';
export const PLAYBACK_SESSION_KEY = 'c64u_playback_session:v1';
export const DEFAULT_SONG_DURATION_MS = 3 * 60 * 1000;
export const DURATION_MIN_SECONDS = 1;
export const DURATION_MAX_SECONDS = 3600;
export const DURATION_SLIDER_STEPS = 1000;

export const formatTime = (ms?: number) => {
  if (ms === undefined) return '—';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const formatBytes = (value?: number | null) => {
  if (value === null || value === undefined || value < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
};

export const isSongCategory = (category: PlayFileCategory) => category === 'sid' || category === 'mod';

export const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

export const getLocalFilePath = (file: LocalPlayFile) => {
  const candidate =
    (file as File).webkitRelativePath || (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return normalizeLocalPath(candidate);
};

export const parseDurationInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(':')) {
    const [minutesRaw, secondsRaw] = trimmed.split(':');
    const minutes = Number(minutesRaw);
    const seconds = Number(secondsRaw);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) return undefined;
    if (seconds < 0 || seconds >= 60) return undefined;
    return Math.max(0, (minutes * 60 + seconds) * 1000);
  }
  const seconds = Number(trimmed);
  if (Number.isNaN(seconds)) return undefined;
  return Math.max(0, seconds * 1000);
};

export const clampDurationSeconds = (value: number) =>
  Math.min(DURATION_MAX_SECONDS, Math.max(DURATION_MIN_SECONDS, value));

export const formatDurationSeconds = (seconds: number) => formatTime(seconds * 1000);

export const durationSecondsToSlider = (seconds: number) => {
  const clamped = clampDurationSeconds(seconds);
  const ratio = Math.log(clamped / DURATION_MIN_SECONDS) / Math.log(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS);
  return Math.round(ratio * DURATION_SLIDER_STEPS);
};

export const sliderToDurationSeconds = (value: number) => {
  const ratio = Math.min(1, Math.max(0, value / DURATION_SLIDER_STEPS));
  const seconds = DURATION_MIN_SECONDS * Math.pow(DURATION_MAX_SECONDS / DURATION_MIN_SECONDS, ratio);
  return clampDurationSeconds(Math.round(seconds));
};

export const parseVolumeOption = (option: string) => {
  const match = option.trim().match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

export const parseModifiedAt = (value?: string | null) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const extractAudioMixerItems = (payload: Record<string, unknown> | undefined): AudioMixerItem[] => {
  if (!payload) return [];
  const categoryData = (payload as Record<string, any>)['Audio Mixer'] ?? payload;
  const itemsData = (categoryData as Record<string, any>)?.items ?? categoryData;
  if (!itemsData || typeof itemsData !== 'object') return [];
  return Object.entries(itemsData)
    .filter(([key]) => key !== 'errors')
    .map(([name, config]) => {
      const normalized = normalizeConfigItem(config);
      return {
        name,
        value: normalized.value,
        options: mergeAudioMixerOptions(normalized.options, normalized.details?.presets),
      };
    });
};

export const shuffleArray = <T,>(items: T[]) => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const getSidSongCount = (buffer: ArrayBuffer) => {
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

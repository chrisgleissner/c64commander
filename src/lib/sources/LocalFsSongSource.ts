/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { computeSidMd5, getSidSongCount } from '@/lib/sid/sidUtils';
import { addErrorLog } from '@/lib/logging';
import type { SongLengthResolveQuery, SongLengthResolution } from '@/lib/songlengths';
import type { SongEntry, SongFolder, SongSource } from './SongSource';

export type LocalSidFile = File | {
  name: string;
  webkitRelativePath?: string;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type LocalFsSongSourceOptions = {
  lookupDurationSeconds?: (md5: string) => Promise<number | null | undefined>;
  lookupDurationsByMd5Seconds?: (md5: string) => Promise<number[] | null | undefined>;
  resolveSonglength?: (query: SongLengthResolveQuery) => Promise<SongLengthResolution>;
  onSongMetadataResolved?: (update: { path: string; entries: SongEntry[] }) => void;
};

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);
const getLocalPath = (file: LocalSidFile) => normalizeLocalPath(file.webkitRelativePath || file.name);
const getPartialPath = (path: string) => {
  const normalized = normalizeLocalPath(path);
  const separator = normalized.lastIndexOf('/');
  if (separator <= 0) return null;
  return normalized.slice(0, separator);
};

const resolveDurationForSong = (durations: number[] | null | undefined, songNr?: number | null) => {
  if (!durations || durations.length === 0) return null;
  const index = songNr && songNr > 0 ? songNr - 1 : 0;
  if (index < 0 || index >= durations.length) return null;
  return durations[index] ?? null;
};

const buildSongEntries = (
  file: LocalSidFile,
  pathValue: string,
  subsongCount: number,
  durationsSeconds: number[] | null = null,
): SongEntry[] => {
  const count = Math.max(1, subsongCount || 1);
  const baseId = `${file.name}-${file.lastModified ?? 0}-${pathValue}`;
  const makeTitle = (songNr: number) => (count > 1 ? `${file.name} (Song ${songNr}/${count})` : file.name);
  if (count === 1) {
    return [{
      id: baseId,
      path: pathValue,
      title: makeTitle(1),
      durationMs: durationsSeconds?.[0] !== undefined ? durationsSeconds[0] * 1000 : undefined,
      songNr: 1,
      subsongCount: 1,
      source: 'local',
      payload: file,
    }];
  }
  return Array.from({ length: count }, (_, index) => ({
    id: `${baseId}:${index + 1}`,
    path: pathValue,
    title: makeTitle(index + 1),
    durationMs: durationsSeconds?.[index] !== undefined ? durationsSeconds[index] * 1000 : undefined,
    songNr: index + 1,
    subsongCount: count,
    source: 'local',
    payload: file,
  }));
};

const extractDurations = (resolution: SongLengthResolution) => {
  if (resolution.durations?.length) return resolution.durations;
  if (resolution.durationSeconds !== null && resolution.durationSeconds !== undefined) {
    return [resolution.durationSeconds];
  }
  return null;
};

const isMd5FallbackCandidate = (resolution: SongLengthResolution, durations: number[] | null) =>
  !durations
  && resolution.strategy !== 'md5'
  && resolution.strategy !== 'unavailable';

const readSidHeader = async (file: LocalSidFile) => {
  const slice = (file as File).slice;
  if (typeof slice === 'function') {
    return slice.call(file, 0, 0x20).arrayBuffer();
  }
  const fullBuffer = await file.arrayBuffer();
  return fullBuffer.byteLength > 0x20 ? fullBuffer.slice(0, 0x20) : fullBuffer;
};

export const createLocalFsSongSource = (
  files: LocalSidFile[],
  options: LocalFsSongSourceOptions = {},
): SongSource => {
  const metadataByPath = new Map<string, SongEntry[]>();
  const durationLookupByPath = new Map<string, number[] | null>();
  const metadataScanInFlight = new Map<string, Promise<void>>();

  const resolveDurationsForFile = async (file: LocalSidFile, pathValue: string, buffer?: ArrayBuffer) => {
    if (durationLookupByPath.has(pathValue)) return durationLookupByPath.get(pathValue) ?? null;
    let durations: number[] | null = null;
    try {
      if (options.resolveSonglength) {
        const baseQuery: SongLengthResolveQuery = {
          fileName: file.name,
          partialPath: getPartialPath(pathValue),
          virtualPath: pathValue,
        };
        const initialResolution = await options.resolveSonglength(baseQuery);
        durations = extractDurations(initialResolution);
        if (isMd5FallbackCandidate(initialResolution, durations)) {
          const fullBuffer = buffer ?? await file.arrayBuffer();
          const md5 = await computeSidMd5(fullBuffer);
          const md5Resolution = await options.resolveSonglength({
            ...baseQuery,
            md5,
          });
          durations = extractDurations(md5Resolution);
        }
      } else if (options.lookupDurationsByMd5Seconds) {
        const fullBuffer = buffer ?? await file.arrayBuffer();
        const md5 = await computeSidMd5(fullBuffer);
        const resolved = await options.lookupDurationsByMd5Seconds(md5);
        durations = resolved?.length ? resolved : null;
      } else if (options.lookupDurationSeconds) {
        const fullBuffer = buffer ?? await file.arrayBuffer();
        const md5 = await computeSidMd5(fullBuffer);
        const resolved = await options.lookupDurationSeconds(md5);
        durations = resolved !== null && resolved !== undefined ? [resolved] : null;
      }
    } catch (error) {
      addErrorLog('SID duration lookup failed', {
        error: (error as Error).message,
        path: pathValue,
      });
      durations = null;
    }
    durationLookupByPath.set(pathValue, durations);
    return durations;
  };

  const scanSongMetadataInBackground = (file: LocalSidFile, pathValue: string) => {
    if (metadataByPath.has(pathValue) || metadataScanInFlight.has(pathValue)) return;
    const scanTask = (async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      let subsongCount = 1;
      let durationsSeconds: number[] | null = null;
      try {
        const headerBuffer = await readSidHeader(file);
        subsongCount = getSidSongCount(headerBuffer);
        durationsSeconds = await resolveDurationsForFile(file, pathValue);
        subsongCount = Math.max(subsongCount, durationsSeconds?.length ?? 1);
      } catch (error) {
        addErrorLog('Local SID metadata scan failed', {
          error: (error as Error).message,
          path: pathValue,
        });
      }
      const entries = buildSongEntries(file, pathValue, subsongCount, durationsSeconds);
      metadataByPath.set(pathValue, entries);
      options.onSongMetadataResolved?.({
        path: pathValue,
        entries,
      });
    })();
    metadataScanInFlight.set(pathValue, scanTask);
    void scanTask.finally(() => {
      metadataScanInFlight.delete(pathValue);
    });
  };

  const listFolders = async (path: string): Promise<SongFolder[]> => {
    const folders = new Set<string>();
    const normalized = normalizeLocalPath(path || '/');
    files.forEach((file) => {
      const filePath = getLocalPath(file);
      if (!filePath.startsWith(normalized)) return;
      const parts = filePath.split('/').filter(Boolean);
      if (parts.length <= 1) return;
      parts.pop();
      const folderPath = `/${parts.join('/')}`;
      if (normalized === '/' || folderPath.startsWith(normalized)) {
        folders.add(folderPath);
      }
    });
    return Array.from(folders)
      .map((folder) => ({ path: folder, name: folder.split('/').pop() || folder }))
      .sort((a, b) => a.path.localeCompare(b.path));
  };

  const listSongs = async (path: string): Promise<SongEntry[]> => {
    const normalized = normalizeLocalPath(path || '/');
    const candidates = files.filter((file) => getLocalPath(file).toLowerCase().startsWith(normalized.toLowerCase()));
    const entries = candidates.flatMap((file) => {
      const pathValue = getLocalPath(file);
      const knownEntries = metadataByPath.get(pathValue);
      if (knownEntries) return knownEntries;
      scanSongMetadataInBackground(file, pathValue);
      return buildSongEntries(file, pathValue, 1, null);
    });
    return entries.sort((left, right) =>
      left.path.localeCompare(right.path) || (left.songNr ?? 1) - (right.songNr ?? 1));
  };

  const getSong = async (entry: SongEntry) => {
    const file = entry.payload as LocalSidFile | undefined;
    if (!file) throw new Error('Missing local file data.');
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    let durationMs: number | undefined = entry.durationMs;
    if (durationMs === undefined) {
      const pathValue = normalizeLocalPath(entry.path);
      const durations = await resolveDurationsForFile(file, pathValue, buffer);
      const seconds = resolveDurationForSong(durations ?? null, entry.songNr ?? null);
      if (seconds !== null) durationMs = seconds * 1000;
    }
    return { data, durationMs, title: entry.title, path: entry.path };
  };

  return {
    id: 'local',
    listFolders,
    listSongs,
    getSong,
  };
};

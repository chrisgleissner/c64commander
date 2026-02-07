import { computeSidMd5, getSidSongCount } from '@/lib/sid/sidUtils';
import { addErrorLog } from '@/lib/logging';
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
};

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);
const getLocalPath = (file: LocalSidFile) => normalizeLocalPath(file.webkitRelativePath || file.name);

export const createLocalFsSongSource = (
  files: LocalSidFile[],
  options: LocalFsSongSourceOptions = {},
): SongSource => {
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
    const entries = await Promise.all(
      candidates.map(async (file) => {
        const baseId = `${file.name}-${file.lastModified ?? 0}`;
        const pathValue = getLocalPath(file);
        let subsongCount = 1;
        let durationsSeconds: number[] | null = null;
        try {
          const buffer = await file.arrayBuffer();
          subsongCount = getSidSongCount(buffer);
          if (options.lookupDurationsByMd5Seconds) {
            const md5 = await computeSidMd5(buffer);
            const durations = await options.lookupDurationsByMd5Seconds(md5);
            if (durations?.length) {
              durationsSeconds = durations;
              subsongCount = Math.max(subsongCount, durations.length);
            }
          }
        } catch (error) {
          addErrorLog('Local SID metadata scan failed', {
            error: (error as Error).message,
            path: pathValue,
          });
        }

        const makeTitle = (songNr: number, count: number) =>
          count > 1 ? `${file.name} (Song ${songNr}/${count})` : file.name;

        if (subsongCount <= 1) {
          return [{
            id: baseId,
            path: pathValue,
            title: makeTitle(1, subsongCount),
            durationMs: durationsSeconds?.[0] ? durationsSeconds[0] * 1000 : undefined,
            songNr: 1,
            subsongCount: subsongCount || 1,
            source: 'local',
            payload: file,
          }];
        }

        return Array.from({ length: subsongCount }, (_, index) => ({
          id: `${baseId}:${index + 1}`,
          path: pathValue,
          title: makeTitle(index + 1, subsongCount),
          durationMs: durationsSeconds?.[index] ? durationsSeconds[index] * 1000 : undefined,
          songNr: index + 1,
          subsongCount,
          source: 'local',
          payload: file,
        }));
      }),
    );
    return entries.flat();
  };

  const resolveDurationForSong = (durations: number[] | null | undefined, songNr?: number | null) => {
    if (!durations || durations.length === 0) return null;
    const index = songNr && songNr > 0 ? songNr - 1 : 0;
    if (index < 0 || index >= durations.length) return null;
    return durations[index] ?? null;
  };

  const getSong = async (entry: SongEntry) => {
    const file = entry.payload as LocalSidFile | undefined;
    if (!file) throw new Error('Missing local file data.');
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    let durationMs: number | undefined = entry.durationMs;
    if (options.lookupDurationsByMd5Seconds) {
      try {
        const md5 = await computeSidMd5(buffer);
        const durations = await options.lookupDurationsByMd5Seconds(md5);
        const seconds = resolveDurationForSong(durations ?? null, entry.songNr ?? null);
        if (seconds !== null) durationMs = seconds * 1000;
      } catch (error) {
        addErrorLog('SID duration lookup failed', {
          error: (error as Error).message,
        });
      }
    } else if (options.lookupDurationSeconds) {
      try {
        const md5 = await computeSidMd5(buffer);
        const result = await options.lookupDurationSeconds(md5);
        if (result) durationMs = result * 1000;
      } catch (error) {
        addErrorLog('SID duration lookup failed', {
          error: (error as Error).message,
        });
      }
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

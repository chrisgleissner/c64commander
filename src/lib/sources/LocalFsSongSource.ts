import { computeSidMd5 } from '@/lib/sid/sidUtils';
import type { SongEntry, SongFolder, SongSource } from './SongSource';

export type LocalSidFile = File | {
  name: string;
  webkitRelativePath?: string;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type LocalFsSongSourceOptions = {
  lookupDurationSeconds?: (md5: string) => Promise<number | null | undefined>;
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
    return files
      .filter((file) => getLocalPath(file).toLowerCase().startsWith(normalized.toLowerCase()))
      .map((file) => ({
        id: `${file.name}-${file.lastModified}`,
        path: getLocalPath(file),
        title: file.name,
        source: 'local',
        payload: file,
      }));
  };

  const getSong = async (entry: SongEntry) => {
    const file = entry.payload as LocalSidFile | undefined;
    if (!file) throw new Error('Missing local file data.');
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    let durationMs: number | undefined = entry.durationMs;
    if (options.lookupDurationSeconds) {
      try {
        const md5 = await computeSidMd5(buffer);
        const result = await options.lookupDurationSeconds(md5);
        if (result) durationMs = result * 1000;
      } catch {
        // ignore lookup failures on web/mock
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

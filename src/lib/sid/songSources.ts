import { HvscIngestion } from '@/lib/native/hvscIngestion';
import { base64ToUint8, computeSidMd5 } from '@/lib/sid/sidUtils';

export type SongSourceId = 'hvsc' | 'local';

export type SongFolder = {
  path: string;
  name: string;
};

export type SongEntry = {
  id: string;
  path: string;
  title: string;
  durationMs?: number;
  source: SongSourceId;
  payload?: unknown;
};

export type SongSource = {
  id: SongSourceId;
  listFolders: (path: string) => Promise<SongFolder[]>;
  listSongs: (path: string) => Promise<SongEntry[]>;
  getSong: (entry: SongEntry) => Promise<{ data: Uint8Array; durationMs?: number; title: string; path?: string }>;
};

export type LocalSidFile = File | {
  name: string;
  webkitRelativePath?: string;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);
const getLocalPath = (file: LocalSidFile) => normalizeLocalPath(file.webkitRelativePath || file.name);

export const createLocalFsSongSource = (files: LocalSidFile[], enableHvscLookup: boolean): SongSource => {
  const listFolders = async (path: string) => {
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

  const listSongs = async (path: string) => {
    const normalized = normalizeLocalPath(path || '/');
    return files
      .filter((file) => getLocalPath(file).toLowerCase().startsWith(normalized.toLowerCase()))
      .map((file) => ({
        id: `${file.name}-${file.lastModified}`,
        path: getLocalPath(file),
        title: file.name,
        source: 'local' as const,
        payload: file,
      }));
  };

  const getSong = async (entry: SongEntry) => {
    const file = entry.payload as LocalSidFile | undefined;
    if (!file) throw new Error('Missing local file data.');
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    let durationMs: number | undefined = entry.durationMs;
    if (enableHvscLookup) {
      try {
        const md5 = await computeSidMd5(buffer);
        const result = await HvscIngestion.getHvscDurationByMd5({ md5 });
        if (result.durationSeconds) durationMs = result.durationSeconds * 1000;
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

export const HvscSongSource: SongSource = {
  id: 'hvsc',
  listFolders: async (path: string) => {
    const listing = await HvscIngestion.getHvscFolderListing({ path });
    return listing.folders.map((folder) => ({ path: folder, name: folder.split('/').pop() || folder }));
  },
  listSongs: async (path: string) => {
    const listing = await HvscIngestion.getHvscFolderListing({ path });
    return listing.songs.map((song) => ({
      id: String(song.id),
      path: song.virtualPath,
      title: song.fileName,
      durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
      source: 'hvsc',
      payload: song,
    }));
  },
  getSong: async (entry: SongEntry) => {
    const payload = entry.payload as { id?: number; virtualPath?: string } | undefined;
    const song = await HvscIngestion.getHvscSong({
      id: payload?.id ? Number(payload.id) : undefined,
      virtualPath: payload?.virtualPath || entry.path,
    });
    const data = base64ToUint8(song.dataBase64);
    const durationMs = song.durationSeconds ? song.durationSeconds * 1000 : undefined;
    return { data, durationMs, title: song.fileName, path: song.virtualPath };
  },
};

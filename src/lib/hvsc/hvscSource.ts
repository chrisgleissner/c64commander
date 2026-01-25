import type { SongEntry, SongFolder, SongSource } from '@/lib/sources/SongSource';
import { base64ToUint8 } from '@/lib/sid/sidUtils';
import { getHvscFolderListing, getHvscSong } from './hvscService';

const mapFolder = (folder: string): SongFolder => ({
  path: folder,
  name: folder.split('/').pop() || folder,
});

export const HvscSongSource: SongSource = {
  id: 'hvsc',
  listFolders: async (path: string) => {
    const listing = await getHvscFolderListing(path);
    return listing.folders.map(mapFolder);
  },
  listSongs: async (path: string) => {
    const listing = await getHvscFolderListing(path);
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
    const song = await getHvscSong({
      virtualPath: payload?.virtualPath || entry.path,
    });
    const data = base64ToUint8(song.dataBase64);
    const durationMs = song.durationSeconds ? song.durationSeconds * 1000 : undefined;
    return { data, durationMs, title: song.fileName, path: song.virtualPath };
  },
};

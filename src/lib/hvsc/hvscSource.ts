/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SongEntry, SongFolder, SongSource } from '@/lib/sources/SongSource';
import { base64ToUint8 } from '@/lib/sid/sidUtils';
import { getHvscFolderListing, getHvscSong } from './hvscService';
import { resolveHvscSonglengthDuration } from './hvscSongLengthService';

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
    const entries = await Promise.all(
      listing.songs.map(async (song) => {
        let durations = song.durationsSeconds ?? null;
        let subsongCount = song.subsongCount ?? (durations?.length ? durations.length : null);

        if (!durations && !subsongCount) {
          const resolution = await resolveHvscSonglengthDuration({
            virtualPath: song.virtualPath,
            fileName: song.fileName,
          });
          durations = resolution.durations ?? null;
          subsongCount = resolution.subsongCount ?? (durations?.length ? durations.length : null);
        }

        const resolvedCount = subsongCount
          ?? (durations?.length ? durations.length : (song.durationSeconds ? 1 : 1));
        const makeTitle = (songNr: number, count: number) =>
          count > 1 ? `${song.fileName} (Song ${songNr}/${count})` : song.fileName;

        if (resolvedCount <= 1) {
          return [{
            id: String(song.id),
            path: song.virtualPath,
            title: makeTitle(1, resolvedCount),
            durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
            songNr: 1,
            subsongCount: resolvedCount,
            source: 'hvsc',
            payload: song,
          }];
        }

        return Array.from({ length: resolvedCount }, (_, index) => ({
          id: `${song.id}:${index + 1}`,
          path: song.virtualPath,
          title: makeTitle(index + 1, resolvedCount),
          durationMs: durations?.[index] ? durations[index] * 1000 : undefined,
          songNr: index + 1,
          subsongCount: resolvedCount,
          source: 'hvsc',
          payload: song,
        }));
      }),
    );
    return entries.flat();
  },
  getSong: async (entry: SongEntry) => {
    const payload = entry.payload as { id?: number; virtualPath?: string } | undefined;
    const song = await getHvscSong({
      virtualPath: payload?.virtualPath || entry.path,
    });
    const data = base64ToUint8(song.dataBase64);
    const durationMs = entry.durationMs ?? (song.durationSeconds ? song.durationSeconds * 1000 : undefined);
    return { data, durationMs, title: song.fileName, path: song.virtualPath };
  },
};

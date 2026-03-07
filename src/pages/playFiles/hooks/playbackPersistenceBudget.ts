import type { PlayFile } from "@/lib/types";

export const LEGACY_PLAYLIST_MAX_ITEMS = 1000;
export const LEGACY_PLAYLIST_MAX_BYTES = 512 * 1024;

export const shouldPersistLegacyPlaylistBlob = (playlist: PlayFile[], payloadBytes: number) => {
  if (playlist.length > LEGACY_PLAYLIST_MAX_ITEMS) {
    return false;
  }
  if (payloadBytes > LEGACY_PLAYLIST_MAX_BYTES) {
    return false;
  }
  return true;
};

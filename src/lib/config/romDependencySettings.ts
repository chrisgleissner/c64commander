/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What to do with a song that was measured to sound different on this phone without the C64's ROMs,
 * when there is no C64 to play it on instead.
 *
 * On by default: the song is skipped when the playlist or a station moves on by itself, and asked
 * about when the listener picks it. Off plays it without asking. With a C64 connected the song
 * plays there, on the real ROMs, whatever this says.
 *
 * Stored like the settings in `appSettings.ts` (a "1" or "0", announced on the same event); it lives
 * here only because that file is at its size limit.
 */

export const SKIP_ROM_DEPENDENT_SONGS_KEY = "c64u_skip_rom_dependent_songs";
export const DEFAULT_SKIP_ROM_DEPENDENT_SONGS = true;

export const loadSkipRomDependentSongs = (): boolean => {
  if (typeof localStorage === "undefined") return DEFAULT_SKIP_ROM_DEPENDENT_SONGS;
  const raw = localStorage.getItem(SKIP_ROM_DEPENDENT_SONGS_KEY);
  return raw === null ? DEFAULT_SKIP_ROM_DEPENDENT_SONGS : raw === "1";
};

export const saveSkipRomDependentSongs = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SKIP_ROM_DEPENDENT_SONGS_KEY, enabled ? "1" : "0");
  window.dispatchEvent(
    new CustomEvent("c64u-app-settings-updated", { detail: { key: SKIP_ROM_DEPENDENT_SONGS_KEY, value: enabled } }),
  );
};

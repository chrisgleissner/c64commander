/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether reading the C64's ROMs from Settings also reads the character ROM.
 *
 * Off by default. KERNAL and BASIC are plain DMA reads, but the character ROM is copied by a routine
 * that runs on the C64 for about 40 ms with I/O banked out, which can disturb a program driven by
 * NMIs. Only the user's own switch turns it on, and only the Settings read honors it: the automatic
 * read that starts with a tune never reads the character ROM.
 *
 * Stored like the settings in `appSettings.ts` (a "1" or "0", announced on the same event); it lives
 * here only because that file is at its size limit.
 */

export const CHARACTER_ROM_READ_KEY = "c64u_read_character_rom";
export const DEFAULT_CHARACTER_ROM_READ = false;

export const loadCharacterRomRead = (): boolean => {
  const raw = localStorage.getItem(CHARACTER_ROM_READ_KEY);
  return raw === null ? DEFAULT_CHARACTER_ROM_READ : raw === "1";
};

export const saveCharacterRomRead = (enabled: boolean) => {
  localStorage.setItem(CHARACTER_ROM_READ_KEY, enabled ? "1" : "0");
  window.dispatchEvent(
    new CustomEvent("c64u-app-settings-updated", { detail: { key: CHARACTER_ROM_READ_KEY, value: enabled } }),
  );
};

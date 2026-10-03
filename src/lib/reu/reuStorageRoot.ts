/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// HARD18-014: /Temp is a volatile RAM disk (hardware-confirmed on both u64 and
// c64u: contents are wiped by a real power cycle, not just a machine:reboot),
// so a REU armed for "Preload on Startup" against /Temp can never fire after
// the power cycle it exists for. Pick a real persistent root instead, never
// /Temp, preferring removable storage over onboard flash.
const NON_PERSISTENT_ROOT_NAMES = new Set(["temp"]);
const PERSISTENT_ROOT_PREFERENCE_PREFIXES = ["sd", "usb", "flash"];

const rankPersistentRootName = (name: string): number => {
  const normalized = name.trim().toLowerCase();
  const index = PERSISTENT_ROOT_PREFERENCE_PREFIXES.findIndex((prefix) => normalized.startsWith(prefix));
  return index === -1 ? PERSISTENT_ROOT_PREFERENCE_PREFIXES.length : index;
};

export const resolvePersistentReuStorageRoot = (rootDirNames: string[]): string | null => {
  const candidates = rootDirNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !NON_PERSISTENT_ROOT_NAMES.has(name.toLowerCase()));
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => rankPersistentRootName(left) - rankPersistentRootName(right))[0];
};

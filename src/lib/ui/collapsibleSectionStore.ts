/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Which collapsible sections a user has opened, shared across every page that uses
// CollapsibleSection (Home, Settings, Docs, and any future one). One user can be a
// completely different person on Home than on Settings, so entries are namespaced by
// `scope` - a Home section id and a Settings section id that happen to collide (e.g.
// both called "video") must not read or write each other's state.
const OPEN_SECTIONS_KEY = "c64u_open_sections";

// Settings shipped its own open/closed memory before this module existed, under this
// key, with un-scoped ids (it was the only page that had the feature). Importing those
// entries once, under scope "settings", means the switch to the shared store does not
// reset what an existing user had already opened.
const LEGACY_SETTINGS_KEY = "c64u_settings_open_sections";
const LEGACY_SETTINGS_SCOPE = "settings";

const compositeKey = (scope: string, id: string): string => `${scope}:${id}`;

const readRawIds = (key: string): Set<string> => {
  if (typeof localStorage === "undefined") return new Set();
  const raw = localStorage.getItem(key);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch (error) {
    console.warn(`Discarding unreadable stored collapsible-section state at ${key}`, error);
    return new Set();
  }
};

const writeRawIds = (key: string, ids: Set<string>): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify([...ids]));
};

/**
 * One-time import of the legacy, Settings-only store into the shared one. Runs at most
 * once: it removes the legacy key as soon as it has copied it, so there is nothing left
 * to migrate on the next call and no risk of re-importing a since-closed section that
 * the user closed after the migration already ran.
 */
const migrateLegacySettingsSections = (): void => {
  if (typeof localStorage === "undefined") return;
  const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_KEY);
  if (legacyRaw === null) return;
  const legacyIds = readRawIds(LEGACY_SETTINGS_KEY);
  const current = readRawIds(OPEN_SECTIONS_KEY);
  for (const id of legacyIds) current.add(compositeKey(LEGACY_SETTINGS_SCOPE, id));
  writeRawIds(OPEN_SECTIONS_KEY, current);
  localStorage.removeItem(LEGACY_SETTINGS_KEY);
};

export const readOpenSections = (scope: string): Set<string> => {
  migrateLegacySettingsSections();
  const prefix = `${scope}:`;
  const ids = new Set<string>();
  for (const key of readRawIds(OPEN_SECTIONS_KEY)) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return ids;
};

export const writeOpenSection = (scope: string, id: string, open: boolean): void => {
  const ids = readRawIds(OPEN_SECTIONS_KEY);
  const key = compositeKey(scope, id);
  if (open) ids.add(key);
  else ids.delete(key);
  writeRawIds(OPEN_SECTIONS_KEY, ids);
};

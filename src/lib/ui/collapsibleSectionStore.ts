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

// Explicit per-id open/closed decisions, never mere absence: a plain set of open ids
// can't distinguish "never touched" from "explicitly closed", which used to collapse
// every untouched defaultOpen section the moment any sibling was toggled (HARD25-001).
// An id absent from this map was never touched and keeps its own defaultOpen.
const readRawEntries = (key: string): Map<string, boolean> => {
  if (typeof localStorage === "undefined") return new Map();
  const raw = localStorage.getItem(key);
  if (!raw) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Pre-fix format: a bare array of open ids. Every id in it was explicitly open;
      // ids outside it may have been untouched OR explicitly closed, and the old format
      // cannot tell those apart. Best-effort: treat every listed id as explicitly open
      // and leave everything else untouched, rather than inventing false closes.
      const entries = new Map<string, boolean>();
      for (const id of parsed) {
        if (typeof id === "string") entries.set(id, true);
      }
      return entries;
    }
    if (parsed && typeof parsed === "object") {
      const entries = new Map<string, boolean>();
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "boolean") entries.set(id, value);
      }
      return entries;
    }
    return new Map();
  } catch (error) {
    console.warn(`Discarding unreadable stored collapsible-section state at ${key}`, error);
    return new Map();
  }
};

const writeRawEntries = (key: string, entries: Map<string, boolean>): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
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
  const legacyEntries = readRawEntries(LEGACY_SETTINGS_KEY);
  const current = readRawEntries(OPEN_SECTIONS_KEY);
  for (const [id, open] of legacyEntries) current.set(compositeKey(LEGACY_SETTINGS_SCOPE, id), open);
  writeRawEntries(OPEN_SECTIONS_KEY, current);
  localStorage.removeItem(LEGACY_SETTINGS_KEY);
};

/** Explicit open/closed decisions for `scope`, keyed by the section id alone (unprefixed).
 * An id absent from the returned map was never toggled by the user. */
export const readSectionStates = (scope: string): Map<string, boolean> => {
  migrateLegacySettingsSections();
  const prefix = `${scope}:`;
  const states = new Map<string, boolean>();
  for (const [key, open] of readRawEntries(OPEN_SECTIONS_KEY)) {
    if (key.startsWith(prefix)) states.set(key.slice(prefix.length), open);
  }
  return states;
};

export const writeSectionState = (scope: string, id: string, open: boolean): void => {
  const entries = readRawEntries(OPEN_SECTIONS_KEY);
  entries.set(compositeKey(scope, id), open);
  writeRawEntries(OPEN_SECTIONS_KEY, entries);
};

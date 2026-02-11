/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PickedFolderEntry } from './folderPicker';

type FolderEntryCandidate = {
  uri?: string;
  name?: string;
  path?: string;
  relativePath?: string;
  webkitRelativePath?: string;
};

const normalizePath = (value: string) => (value.startsWith('/') ? value : `/${value}`);

const toPickedFolderEntry = (value: unknown): PickedFolderEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as FolderEntryCandidate;
  const uri = typeof candidate.uri === 'string' ? candidate.uri : undefined;
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  const pathRaw =
    typeof candidate.path === 'string'
      ? candidate.path
      : typeof candidate.relativePath === 'string'
        ? candidate.relativePath
        : typeof candidate.webkitRelativePath === 'string'
          ? candidate.webkitRelativePath
          : undefined;
  if (!uri || !name) return null;
  const path = normalizePath(pathRaw ?? name);
  return { uri, name, path };
};

const isArrayLike = (value: unknown): value is ArrayLike<PickedFolderEntry> =>
  Boolean(value && typeof value === 'object' && 'length' in value);

const isIterable = (value: unknown): value is Iterable<PickedFolderEntry> =>
  Boolean(value && typeof value === 'object' && typeof (value as Iterable<PickedFolderEntry>)[Symbol.iterator] === 'function');

const normalizeEntries = (entries: unknown[]): PickedFolderEntry[] | null => {
  if (!entries.length) return [];
  const normalized = entries.map(toPickedFolderEntry).filter((entry): entry is PickedFolderEntry => Boolean(entry));
  if (!normalized.length) return null;
  return normalized;
};

const entriesFromObject = (value: object): PickedFolderEntry[] | null => {
  if ('files' in value) {
    return coerceFolderPickerEntries((value as { files?: unknown }).files);
  }
  if ('entries' in value) {
    return coerceFolderPickerEntries((value as { entries?: unknown }).entries);
  }
  const values = Object.values(value);
  return normalizeEntries(values);
};

export const coerceFolderPickerEntries = (files: unknown): PickedFolderEntry[] | null => {
  if (!files) return [];
  if (Array.isArray(files)) return normalizeEntries(files);
  if (typeof files === 'string') {
    try {
      const parsed = JSON.parse(files) as unknown;
      if (Array.isArray(parsed)) return normalizeEntries(parsed);
      if (parsed && typeof parsed === 'object') return entriesFromObject(parsed as object);
    } catch (error) {
      console.warn('Failed to parse folder picker entries', { error });
      return null;
    }
  }
  if (isArrayLike(files)) return normalizeEntries(Array.from(files));
  if (isIterable(files)) return normalizeEntries(Array.from(files));
  if (typeof files === 'object') {
    const single = toPickedFolderEntry(files);
    if (single) return [single];
    return entriesFromObject(files);
  }
  return null;
};

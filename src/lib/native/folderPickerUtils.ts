import type { PickedFolderEntry } from './folderPicker';

const isPickedFolderEntry = (value: unknown): value is PickedFolderEntry =>
  Boolean(value && typeof value === 'object' && 'uri' in value && 'name' in value && 'path' in value);

const isArrayLike = (value: unknown): value is ArrayLike<PickedFolderEntry> =>
  Boolean(value && typeof value === 'object' && 'length' in value);

const isIterable = (value: unknown): value is Iterable<PickedFolderEntry> =>
  Boolean(value && typeof value === 'object' && typeof (value as Iterable<PickedFolderEntry>)[Symbol.iterator] === 'function');

const entriesFromObject = (value: object): PickedFolderEntry[] | null => {
  const values = Object.values(value);
  if (!values.length) return [];
  if (values.every(isPickedFolderEntry)) return values as PickedFolderEntry[];
  return null;
};

export const coerceFolderPickerEntries = (files: unknown): PickedFolderEntry[] | null => {
  if (!files) return [];
  if (Array.isArray(files)) return files as PickedFolderEntry[];
  if (typeof files === 'string') {
    try {
      const parsed = JSON.parse(files) as unknown;
      if (Array.isArray(parsed)) return parsed as PickedFolderEntry[];
    } catch {
      return null;
    }
  }
  if (isArrayLike(files)) return Array.from(files);
  if (isIterable(files)) return Array.from(files);
  if (typeof files === 'object') {
    return entriesFromObject(files);
  }
  return null;
};

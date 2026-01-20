import type { FileLibraryEntry } from './fileLibraryTypes';

export type FileLibraryState = {
  entries: FileLibraryEntry[];
};

const STORE_PREFIX = 'c64u_file_library:';

export const loadFileLibrary = (key: string): FileLibraryState => {
  if (typeof localStorage === 'undefined') return { entries: [] };
  const raw = localStorage.getItem(`${STORE_PREFIX}${key}`);
  if (!raw) return { entries: [] };
  try {
    const parsed = JSON.parse(raw) as FileLibraryState;
    return parsed?.entries ? parsed : { entries: [] };
  } catch {
    return { entries: [] };
  }
};

export const saveFileLibrary = (key: string, state: FileLibraryState) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`${STORE_PREFIX}${key}`, JSON.stringify(state));
};
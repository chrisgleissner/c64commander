/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addErrorLog } from '@/lib/logging';
import { loadFileLibrary, saveFileLibrary } from '@/lib/playback/fileLibraryStore';
import type { FileLibraryEntry, FileLibraryRuntime } from '@/lib/playback/fileLibraryTypes';

export type FileLibrary = {
  entries: FileLibraryEntry[];
  runtimeFiles: FileLibraryRuntime;
  addEntries: (entries: FileLibraryEntry[], runtime?: FileLibraryRuntime) => void;
  removeEntry: (id: string) => void;
  clearLibrary: () => void;
};

export const useFileLibrary = (uniqueId: string | null): FileLibrary => {
  const [entries, setEntries] = useState<FileLibraryEntry[]>([]);
  const [runtimeFiles, setRuntimeFiles] = useState<FileLibraryRuntime>({});

  useEffect(() => {
    if (!uniqueId) return;
    const state = loadFileLibrary(uniqueId);
    setEntries(state.entries || []);
  }, [uniqueId]);

  useEffect(() => {
    if (!uniqueId) return;
    saveFileLibrary(uniqueId, { entries });
  }, [entries, uniqueId]);

  const addEntries = useCallback((next: FileLibraryEntry[], runtime: FileLibraryRuntime = {}) => {
    setRuntimeFiles((prev) => ({ ...prev, ...runtime }));
    setEntries((prev) => {
      const existing = new Set(prev.map((entry) => entry.id));
      const merged = [...prev];
      next.forEach((entry) => {
        if (existing.has(entry.id)) return;
        merged.push(entry);
      });
      return merged;
    });
  }, []);

  const removeEntry = useCallback((id: string) => {
    setRuntimeFiles((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearLibrary = useCallback(() => {
    setRuntimeFiles({});
    setEntries([]);
  }, []);

  const memo = useMemo(() => ({ entries, runtimeFiles, addEntries, removeEntry, clearLibrary }), [entries, runtimeFiles, addEntries, removeEntry, clearLibrary]);

  if (!uniqueId) {
    addErrorLog('File library missing device id', { entries: entries.length });
  }

  return memo;
};
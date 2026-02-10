/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createLocalSourceFromFileList,
  createLocalSourceFromPicker,
  loadLocalSources,
  saveLocalSources,
  setLocalSourceRuntimeFiles,
  type LocalSourceRecord,
} from '@/lib/sourceNavigation/localSourcesStore';

export type UseLocalSourcesState = {
  sources: LocalSourceRecord[];
  addSourceFromPicker: (input: HTMLInputElement | null) => Promise<LocalSourceRecord | null>;
  addSourceFromFiles: (files: FileList | File[], label?: string) => LocalSourceRecord | null;
  removeSource: (sourceId: string) => void;
  replaceSources: (sources: LocalSourceRecord[]) => void;
};

export const useLocalSources = (): UseLocalSourcesState => {
  const [sources, setSources] = useState<LocalSourceRecord[]>(() => loadLocalSources());

  useEffect(() => {
    if (sources.length) return;
    const stored = loadLocalSources();
    if (stored.length) {
      setSources(stored);
    }
  }, [sources.length]);

  const persist = useCallback((next: LocalSourceRecord[]) => {
    setSources(next);
    saveLocalSources(next);
  }, []);

  const addSourceFromPicker = useCallback(async (input: HTMLInputElement | null) => {
    const result = await createLocalSourceFromPicker(input);
    if (!result) return null;
    setLocalSourceRuntimeFiles(result.source.id, result.runtimeFiles);
    persist([result.source, ...sources]);
    return result.source;
  }, [persist, sources]);

  const addSourceFromFiles = useCallback((files: FileList | File[], label?: string) => {
    if (!files) return null;
    if ((Array.isArray(files) ? files.length : files.length) === 0) return null;
    const result = createLocalSourceFromFileList(files, label);
    setLocalSourceRuntimeFiles(result.source.id, result.runtimeFiles);
    persist([result.source, ...sources]);
    return result.source;
  }, [persist, sources]);

  const removeSource = useCallback((sourceId: string) => {
    persist(sources.filter((source) => source.id !== sourceId));
  }, [persist, sources]);

  const replaceSources = useCallback((next: LocalSourceRecord[]) => {
    persist(next);
  }, [persist]);

  return {
    sources,
    addSourceFromPicker,
    addSourceFromFiles,
    removeSource,
    replaceSources,
  };
};

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
  addSourceFromPicker: (input: HTMLInputElement | null) => Promise<void>;
  addSourceFromFiles: (files: FileList | File[], label?: string) => void;
  removeSource: (sourceId: string) => void;
  replaceSources: (sources: LocalSourceRecord[]) => void;
};

export const useLocalSources = (): UseLocalSourcesState => {
  const [sources, setSources] = useState<LocalSourceRecord[]>([]);

  useEffect(() => {
    setSources(loadLocalSources());
  }, []);

  const persist = useCallback((next: LocalSourceRecord[]) => {
    setSources(next);
    saveLocalSources(next);
  }, []);

  const addSourceFromPicker = useCallback(async (input: HTMLInputElement | null) => {
    const result = await createLocalSourceFromPicker(input);
    if (!result) return;
    setLocalSourceRuntimeFiles(result.source.id, result.runtimeFiles);
    persist([result.source, ...sources]);
  }, [persist, sources]);

  const addSourceFromFiles = useCallback((files: FileList | File[], label?: string) => {
    if (!files || (Array.isArray(files) && files.length === 0)) return;
    const result = createLocalSourceFromFileList(files, label);
    setLocalSourceRuntimeFiles(result.source.id, result.runtimeFiles);
    persist([result.source, ...sources]);
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
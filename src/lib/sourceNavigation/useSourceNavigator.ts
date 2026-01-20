import { useCallback, useEffect, useState } from 'react';
import { ensureWithinRoot, getParentPathWithinRoot } from './paths';
import type { ScopedEntry, ScopedSource } from './types';

export type ScopedBrowserState = {
  path: string;
  entries: ScopedEntry[];
  isLoading: boolean;
  error: string | null;
  navigateTo: (path: string) => void;
  navigateUp: () => void;
  refresh: () => void;
};

export const useScopedBrowser = (source: ScopedSource | null): ScopedBrowserState => {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<ScopedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async (nextPath: string) => {
    if (!source) return;
    setIsLoading(true);
    setError(null);
    try {
      const safePath = ensureWithinRoot(nextPath, source.rootPath);
      const result = await source.listEntries(safePath);
      setEntries(result);
      setPath(safePath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  useEffect(() => {
    if (!source) return;
    void loadEntries(source.rootPath);
  }, [loadEntries, source]);

  const navigateTo = useCallback((nextPath: string) => {
    if (!source) return;
    void loadEntries(nextPath);
  }, [loadEntries, source]);

  const navigateUp = useCallback(() => {
    if (!source) return;
    const parent = getParentPathWithinRoot(path, source.rootPath);
    void loadEntries(parent);
  }, [loadEntries, path, source]);

  const refresh = useCallback(() => {
    if (!source) return;
    void loadEntries(path);
  }, [loadEntries, path, source]);

  return {
    path,
    entries,
    isLoading,
    error,
    navigateTo,
    navigateUp,
    refresh,
  };
};
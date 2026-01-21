import { useCallback, useEffect, useState } from 'react';
import { ensureWithinRoot, getParentPathWithinRoot } from './paths';
import type { SourceEntry, SourceLocation } from './types';

export type SourceNavigatorState = {
  path: string;
  entries: SourceEntry[];
  isLoading: boolean;
  error: string | null;
  navigateTo: (path: string) => void;
  navigateUp: () => void;
  navigateRoot: () => void;
  refresh: () => void;
};

const buildNavKey = (source: SourceLocation) => `c64u_source_nav:${source.type}:${source.id}`;

const getStoredPath = (source: SourceLocation) => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(buildNavKey(source));
  return raw || null;
};

const setStoredPath = (source: SourceLocation, path: string) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(buildNavKey(source), path);
};

export const useSourceNavigator = (source: SourceLocation | null): SourceNavigatorState => {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<SourceEntry[]>([]);
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
    const stored = getStoredPath(source);
    const initialPath = stored ? ensureWithinRoot(stored, source.rootPath) : source.rootPath;
    void loadEntries(initialPath);
  }, [loadEntries, source]);

  useEffect(() => {
    if (!source) return;
    setStoredPath(source, path);
  }, [path, source]);

  const navigateTo = useCallback((nextPath: string) => {
    if (!source) return;
    void loadEntries(nextPath);
  }, [loadEntries, source]);

  const navigateUp = useCallback(() => {
    if (!source) return;
    const parent = getParentPathWithinRoot(path, source.rootPath);
    void loadEntries(parent);
  }, [loadEntries, path, source]);

  const navigateRoot = useCallback(() => {
    if (!source) return;
    void loadEntries(source.rootPath);
  }, [loadEntries, source]);

  const refresh = useCallback(() => {
    if (!source) return;
    source.clearCacheForPath?.(path);
    void loadEntries(path);
  }, [loadEntries, path, source]);

  return {
    path,
    entries,
    isLoading,
    error,
    navigateTo,
    navigateUp,
    navigateRoot,
    refresh,
  };
};
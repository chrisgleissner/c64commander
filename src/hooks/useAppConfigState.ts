/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getC64API, ConfigResponse, getDefaultBaseUrl } from '@/lib/c64api';
import {
  AppConfigEntry,
  ConfigSnapshot,
  createAppConfigEntry,
  listAppConfigs,
  loadHasChanges,
  loadInitialSnapshot,
  saveAppConfigs,
  saveInitialSnapshot,
  updateHasChanges,
  loadAppConfigs,
} from '@/lib/config/appConfigStore';
import { useC64Connection } from '@/hooks/useC64Connection';

const isReadOnlyItem = (name: string) => name.startsWith('SID Detected Socket');

const extractValue = (config: unknown) => {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return config as string | number;
  }

  const cfg = config as Record<string, any>;
  return (
    cfg.selected ??
    cfg.value ??
    cfg.current ??
    cfg.current_value ??
    cfg.currentValue ??
    cfg.default ??
    cfg.default_value ??
    ''
  );
};

const extractItems = (categoryName: string, response: ConfigResponse) => {
  const categoryBlock = (response as Record<string, any>)[categoryName] ?? response;
  const itemsBlock = (categoryBlock as Record<string, any>)?.items ?? categoryBlock;

  if (!itemsBlock || typeof itemsBlock !== 'object') return [] as Array<{ name: string; value: string | number }>;

  return Object.entries(itemsBlock)
    .filter(([key]) => key !== 'errors')
    .map(([name, config]) => ({ name, value: extractValue(config) }));
};

const fetchAllConfig = async () => {
  const api = getC64API();
  const cats = await api.getCategories();
  const configs: Record<string, ConfigResponse> = {};

  for (const category of cats.categories) {
    try {
      configs[category] = await api.getCategory(category);
    } catch (error) {
      console.warn(`Failed to fetch category ${category}:`, error);
    }
  }

  return configs;
};

export function useAppConfigState() {
  const { status, baseUrl } = useC64Connection();
  const queryClient = useQueryClient();
  const resolvedBaseUrl = baseUrl || getDefaultBaseUrl();

  const [initialSnapshot, setInitialSnapshot] = useState<ConfigSnapshot | null>(() =>
    loadInitialSnapshot(resolvedBaseUrl),
  );
  const [hasChanges, setHasChanges] = useState(() => loadHasChanges(resolvedBaseUrl));
  const [appConfigs, setAppConfigs] = useState<AppConfigEntry[]>(() => listAppConfigs(resolvedBaseUrl));
  const [isSnapshotLoading, setSnapshotLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const hasCapturedRef = useRef(false);
  const sessionSnapshotKey = `c64u_initial_snapshot_session:${resolvedBaseUrl}`;

  useEffect(() => {
    setInitialSnapshot(loadInitialSnapshot(resolvedBaseUrl));
    setHasChanges(loadHasChanges(resolvedBaseUrl));
    setAppConfigs(listAppConfigs(resolvedBaseUrl));
  }, [resolvedBaseUrl]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { baseUrl?: string; value?: boolean } | undefined;
      if (!detail || detail.baseUrl !== resolvedBaseUrl) return;
      if (typeof detail.value === 'boolean') {
        setHasChanges(detail.value);
      }
    };

    window.addEventListener('c64u-has-changes', handler as EventListener);
    return () => window.removeEventListener('c64u-has-changes', handler as EventListener);
  }, [resolvedBaseUrl]);

  useEffect(() => {
    if (!status.isConnected) {
      hasCapturedRef.current = false;
      return;
    }
    if (sessionStorage.getItem(sessionSnapshotKey) === '1') {
      hasCapturedRef.current = true;
    }
    if (hasCapturedRef.current || isSnapshotLoading) return;

    let isMounted = true;
    setSnapshotLoading(true);

    fetchAllConfig()
      .then((data) => {
        if (!isMounted) return;
        const snapshot = { savedAt: new Date().toISOString(), data };
        saveInitialSnapshot(resolvedBaseUrl, snapshot);
        setInitialSnapshot(snapshot);
        updateHasChanges(resolvedBaseUrl, false);
        hasCapturedRef.current = true;
        sessionStorage.setItem(sessionSnapshotKey, '1');
      })
      .catch((error) => {
        console.warn('Failed to capture initial config snapshot:', error);
      })
      .finally(() => {
        if (isMounted) setSnapshotLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [status.isConnected, isSnapshotLoading, resolvedBaseUrl, sessionSnapshotKey]);

  const applyConfigData = useCallback(
    async (data: Record<string, ConfigResponse>) => {
      const api = getC64API();
      const payload: Record<string, Record<string, string | number>> = {};

      for (const [categoryName, response] of Object.entries(data)) {
        const items = extractItems(categoryName, response);
        if (!items.length) continue;
        const categoryPayload: Record<string, string | number> = {};

        for (const item of items) {
          if (isReadOnlyItem(item.name)) continue;
          categoryPayload[item.name] = item.value;
        }

        if (Object.keys(categoryPayload).length > 0) {
          payload[categoryName] = categoryPayload;
        }
      }

      await api.updateConfigBatch(payload);

      queryClient.invalidateQueries({ queryKey: ['c64-category'] });
      queryClient.invalidateQueries({ queryKey: ['c64-all-config'] });
    },
    [queryClient],
  );

  const revertToInitial = useCallback(async () => {
    if (!initialSnapshot) return;
    setIsApplying(true);
    try {
      await applyConfigData(initialSnapshot.data);
      updateHasChanges(resolvedBaseUrl, false);
    } finally {
      setIsApplying(false);
    }
  }, [applyConfigData, initialSnapshot, resolvedBaseUrl]);

  const saveCurrentConfig = useCallback(
    async (name: string) => {
      setIsSaving(true);
      try {
        const data = await fetchAllConfig();
        const entry = createAppConfigEntry(resolvedBaseUrl, name, data);
        const next = [entry, ...loadAppConfigs().filter((cfg) => cfg.id !== entry.id)];
        saveAppConfigs(next);
        setAppConfigs(listAppConfigs(resolvedBaseUrl));
        return entry;
      } finally {
        setIsSaving(false);
      }
    },
    [resolvedBaseUrl],
  );

  const loadAppConfig = useCallback(
    async (entry: AppConfigEntry) => {
      setIsApplying(true);
      try {
        await applyConfigData(entry.data);
        updateHasChanges(resolvedBaseUrl, true);
      } finally {
        setIsApplying(false);
      }
    },
    [applyConfigData, resolvedBaseUrl],
  );

  const renameAppConfig = useCallback(
    (entryId: string, name: string) => {
      const allConfigs = loadAppConfigs();
      const next = allConfigs.map((entry) =>
        entry.id === entryId ? { ...entry, name } : entry,
      );
      saveAppConfigs(next);
      setAppConfigs(listAppConfigs(resolvedBaseUrl));
    },
    [resolvedBaseUrl],
  );

  const deleteAppConfig = useCallback(
    (entryId: string) => {
      const allConfigs = loadAppConfigs();
      const next = allConfigs.filter((entry) => entry.id !== entryId);
      saveAppConfigs(next);
      setAppConfigs(listAppConfigs(resolvedBaseUrl));
    },
    [resolvedBaseUrl],
  );

  const markChanged = useCallback(() => updateHasChanges(resolvedBaseUrl, true), [resolvedBaseUrl]);
  const clearChanges = useCallback(() => updateHasChanges(resolvedBaseUrl, false), [resolvedBaseUrl]);

  return {
    initialSnapshot,
    isSnapshotLoading,
    hasChanges,
    isApplying,
    isSaving,
    appConfigs,
    markChanged,
    clearChanges,
    revertToInitial,
    saveCurrentConfig,
    loadAppConfig,
    renameAppConfig,
    deleteAppConfig,
  };
}

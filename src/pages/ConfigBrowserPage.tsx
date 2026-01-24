import { useState, useMemo, useEffect, useReducer, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronDown, Loader2, RefreshCw, FolderOpen } from 'lucide-react';
import { useC64Categories, useC64Category, useC64SetConfig, useC64Connection } from '@/hooks/useC64Connection';
import { useAppConfigState } from '@/hooks/useAppConfigState';
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { useC64UpdateConfigBatch } from '@/hooks/useC64Connection';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { resolveAudioMixerResetValue } from '@/lib/config/audioMixer';
import { useRefreshControl } from '@/hooks/useRefreshControl';
import { isAudioMixerValueEqual } from '@/lib/config/audioMixer';
import { getC64API } from '@/lib/c64api';
import { cn } from '@/lib/utils';
import {
  buildSoloRoutingUpdates,
  isSidVolumeName,
  soloReducer,
} from '@/lib/config/audioMixerSolo';
import { normalizeConfigItem, type NormalizedConfigItem } from '@/lib/config/normalizeConfigItem';
import { AppBar } from '@/components/AppBar';

type ConfigListItem = {
  name: string;
  value: string | number;
  options?: string[];
  details?: NormalizedConfigItem['details'];
};

function CategorySection({
  categoryName,
  onOpenChange,
  markChanged,
}: {
  categoryName: string;
  onOpenChange: (isOpen: boolean) => void;
  markChanged: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { data: categoryData, isLoading, refetch } = useC64Category(categoryName, isOpen);
  const setConfig = useC64SetConfig();
  const updateConfigBatch = useC64UpdateConfigBatch();
  const isAudioMixer = categoryName === 'Audio Mixer';
  const [soloState, dispatchSolo] = useReducer(soloReducer, { soloItem: null });
  const [audioConfiguredItems, setAudioConfiguredItems] = useState<ConfigListItem[]>([]);
  const audioConfiguredRef = useRef<ConfigListItem[]>([]);
  const soloSnapshotRef = useRef<ConfigListItem[]>([]);
  const wasSoloActiveRef = useRef(false);
  const [isEditingVolumes, setIsEditingVolumes] = useState(false);
  const editTimeoutRef = useRef<number | null>(null);
  const skipSoloRoutingRef = useRef(false);
  const soloSnapshotKey = 'c64u_audio_mixer_solo_snapshot';

  useEffect(() => {
    if (isOpen) {
      refetch();
    }
  }, [isOpen, refetch]);

  useEffect(() => {
    onOpenChange(isOpen);
  }, [isOpen, onOpenChange]);

  const items = useMemo<ConfigListItem[]>(() => {
    if (!categoryData) return [];
    
    const catData = categoryData[categoryName] as any;
    if (!catData || typeof catData !== 'object') return [];

    const itemsData = (catData as any).items ?? catData;
    
    return Object.entries(itemsData)
      .filter(([key]) => key !== 'errors')
      .map(([name, config]) => ({
        name,
        ...normalizeConfigItem(config),
      }));
  }, [categoryData, categoryName]);

  const syncAudioConfiguredItems = useCallback((next: ConfigListItem[]) => {
    setAudioConfiguredItems(next);
    audioConfiguredRef.current = next;
  }, []);

  useEffect(() => {
    if (!isAudioMixer) return;
    if (items.length === 0) {
      setAudioConfiguredItems([]);
      audioConfiguredRef.current = [];
      soloSnapshotRef.current = [];
      return;
    }
    if (soloState.soloItem) {
      if (!audioConfiguredItems.length) {
        syncAudioConfiguredItems(items);
      }
      return;
    }
    const snapshot = soloSnapshotRef.current.length ? soloSnapshotRef.current : items;
    syncAudioConfiguredItems(snapshot);
    soloSnapshotRef.current = snapshot;
  }, [audioConfiguredItems.length, isAudioMixer, items, soloState.soloItem, syncAudioConfiguredItems]);

  useEffect(() => {
    if (!isAudioMixer) return;
    audioConfiguredRef.current = audioConfiguredItems;
  }, [isAudioMixer, audioConfiguredItems]);

  useEffect(() => () => {
    if (editTimeoutRef.current) {
      window.clearTimeout(editTimeoutRef.current);
    }
  }, []);

  const applySoloRouting = useCallback(
    async (soloItem: string | null, configuredOverride?: ConfigListItem[]) => {
      if (!isAudioMixer) return;
      const configured = configuredOverride && configuredOverride.length > 0
        ? configuredOverride
        : audioConfiguredRef.current;
      if (!configured.length) return;
      if (soloItem) {
        soloSnapshotRef.current = configured;
        try {
          sessionStorage.setItem(soloSnapshotKey, JSON.stringify(configured));
        } catch (error) {
          addErrorLog('Solo snapshot save failed', { error: (error as Error).message });
        }
      }
      const updates = buildSoloRoutingUpdates(configured, soloItem);
      if (Object.keys(updates).length === 0) return;
      try {
        const api = getC64API();
        await api.updateConfigBatch({ [categoryName]: updates });
        if (!soloItem) {
          try {
            sessionStorage.removeItem(soloSnapshotKey);
          } catch (error) {
            addErrorLog('Solo snapshot cleanup failed', { error: (error as Error).message });
          }
        }
      } catch (error) {
        addErrorLog('Solo routing update failed', {
          error: (error as Error).message,
          category: categoryName,
          soloItem: soloItem ?? 'none',
        });
        toast({
          title: 'Audio routing error',
          description: (error as Error).message,
          variant: 'destructive',
        });
      }
    },
    [isAudioMixer, categoryName],
  );

  useEffect(() => {
    if (!isAudioMixer) return;
    const isActive = Boolean(soloState.soloItem);
    if (skipSoloRoutingRef.current && !isActive) {
      skipSoloRoutingRef.current = false;
      wasSoloActiveRef.current = false;
      return;
    }
    if (isActive || wasSoloActiveRef.current) {
      void applySoloRouting(soloState.soloItem);
    }
    wasSoloActiveRef.current = wasSoloActiveRef.current || isActive;
  }, [isAudioMixer, soloState.soloItem, applySoloRouting]);

  const restoredSnapshotRef = useRef(false);

  useEffect(() => {
    if (!isAudioMixer) return;
    if (soloState.soloItem) return;
    if (restoredSnapshotRef.current) return;
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(soloSnapshotKey);
    } catch (error) {
      addErrorLog('Solo snapshot read failed', { error: (error as Error).message });
      restoredSnapshotRef.current = true;
      return;
    }
    if (!stored) {
      restoredSnapshotRef.current = true;
      return;
    }
    try {
      const parsed = JSON.parse(stored) as ConfigListItem[];
      if (Array.isArray(parsed) && parsed.length) {
        void applySoloRouting(null, parsed);
      }
    } catch (error) {
      addErrorLog('Solo snapshot parse failed', { error: (error as Error).message });
    } finally {
      restoredSnapshotRef.current = true;
    }
  }, [applySoloRouting, isAudioMixer, soloState.soloItem]);

  useEffect(() => {
    if (!isAudioMixer) return undefined;
    return () => {
      if (!wasSoloActiveRef.current && !soloState.soloItem) return;
      const configured = audioConfiguredRef.current.length
        ? audioConfiguredRef.current
        : items;
      let snapshot = soloSnapshotRef.current.length ? soloSnapshotRef.current : configured;
      try {
        const stored = sessionStorage.getItem(soloSnapshotKey);
        if (stored) {
          const parsed = JSON.parse(stored) as ConfigListItem[];
          if (Array.isArray(parsed) && parsed.length) snapshot = parsed;
        }
      } catch (error) {
        addErrorLog('Solo snapshot restore failed', { error: (error as Error).message });
      }
      if (snapshot.length) {
        void applySoloRouting(null, snapshot);
      }
    };
  }, [isAudioMixer, applySoloRouting, items, soloState.soloItem]);

  const handleValueChange = async (itemName: string, value: string | number) => {
    try {
      await setConfig.mutateAsync({
        category: categoryName,
        item: itemName,
        value,
      });
      toast({ title: `${itemName} updated` });
    } catch (error) {
      toast({
        title: 'Error',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const updateAudioConfiguredValue = useCallback(
    (itemName: string, value: string | number) => {
      setAudioConfiguredItems((prev) => {
        const source = prev.length ? prev : items;
        const next = source.map((item) => (item.name === itemName ? { ...item, value } : item));
        audioConfiguredRef.current = next;
        return next;
      });
    },
    [items],
  );

  const handleAudioValueChange = async (itemName: string, value: string | number) => {
    const wasSoloActive = Boolean(soloState.soloItem);
    if (wasSoloActive) {
      skipSoloRoutingRef.current = true;
      dispatchSolo({ type: 'reset' });
    }
    setIsEditingVolumes(true);
    if (editTimeoutRef.current) {
      window.clearTimeout(editTimeoutRef.current);
    }
    editTimeoutRef.current = window.setTimeout(() => setIsEditingVolumes(false), 800);
    updateAudioConfiguredValue(itemName, value);
    if (wasSoloActive) {
      const snapshot = soloSnapshotRef.current.length
        ? soloSnapshotRef.current
        : audioConfiguredRef.current.length
          ? audioConfiguredRef.current
          : items;
      const updates = buildSoloRoutingUpdates(snapshot, null);
      updates[itemName] = value;
      try {
        await updateConfigBatch.mutateAsync({ category: categoryName, updates });
        soloSnapshotRef.current = audioConfiguredRef.current.length ? audioConfiguredRef.current : items;
      } catch (error) {
        addErrorLog('Audio mixer update failed', {
          error: (error as Error).message,
          category: categoryName,
        });
        toast({
          title: 'Error',
          description: (error as Error).message,
          variant: 'destructive',
        });
      }
      return;
    }
    await handleValueChange(itemName, value);
    if (!soloState.soloItem) {
      soloSnapshotRef.current = audioConfiguredRef.current.length ? audioConfiguredRef.current : items;
    }
  };

  const handleSyncClock = async () => {
    if (categoryName !== 'Clock Settings') return;
    const now = new Date();
    const updates: Record<string, string | number> = {};
    const normalizedItems = items.map((item) => ({
      item,
      name: item.name.toLowerCase(),
    }));

    const setIfMatch = (matcher: (name: string) => boolean, value: number) => {
      normalizedItems
        .filter((entry) => matcher(entry.name))
        .forEach((entry) => {
          updates[entry.item.name] = value;
        });
    };

    setIfMatch((name) => name.includes('year'), now.getFullYear());
    setIfMatch((name) => name.includes('month'), now.getMonth() + 1);
    setIfMatch((name) => name.includes('day'), now.getDate());
    setIfMatch((name) => name.includes('hour'), now.getHours());
    setIfMatch((name) => name.includes('minute'), now.getMinutes());
    setIfMatch((name) => name.includes('second'), now.getSeconds());

    if (Object.keys(updates).length === 0) {
      toast({
        title: 'Clock sync unavailable',
        description: 'No matching clock fields found in this section.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await updateConfigBatch.mutateAsync({ category: categoryName, updates });
      markChanged();
      toast({ title: 'Clock synced', description: 'C64U clock updated from device time.' });
    } catch (error) {
      addErrorLog('Clock sync failed', {
        error: (error as Error).message,
        category: categoryName,
      });
      toast({
        title: 'Clock sync failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const resetAudioMixer = async () => {
    if (categoryName !== 'Audio Mixer') return;
    setIsResetting(true);
    try {
      const updates: Record<string, string | number> = {};
      for (const item of items) {
        const target = await resolveAudioMixerResetValue(categoryName, item.name, item.options);
        if (target === undefined) continue;
        if (isAudioMixerValueEqual(item.value, target)) continue;
        updates[item.name] = target;
      }

      if (Object.keys(updates).length === 0) {
        toast({ title: 'Audio Mixer already at defaults', description: 'No changes needed.' });
        return;
      }

      await updateConfigBatch.mutateAsync({ category: categoryName, updates });
      markChanged();
      toast({ title: 'Audio Mixer reset', description: 'Volumes set to 0 dB, pans centered.' });
    } catch (error) {
      addErrorLog('Audio Mixer reset failed', {
        error: (error as Error).message,
        category: categoryName,
      });
      toast({
        title: 'Error',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const displayItems = isAudioMixer && audioConfiguredItems.length ? audioConfiguredItems : items;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="font-medium text-sm">{categoryName}</span>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-border px-4 pb-2">
              <div className="flex items-center justify-between gap-2 py-3" data-testid="config-group-actions">
                <div className="flex items-center gap-2">
                  {categoryName === 'Audio Mixer' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetAudioMixer}
                      disabled={isResetting || isLoading || items.length === 0}
                      className="text-xs"
                    >
                      Reset Audio Mixer
                    </Button>
                  )}
                  {categoryName === 'Clock Settings' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSyncClock}
                      disabled={isLoading || items.length === 0 || updateConfigBatch.isPending}
                      className="text-xs"
                    >
                      Sync clock
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetch()}
                  className="text-xs"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refresh
                </Button>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No settings available
                </div>
              ) : (
                <div className="divide-y divide-border" data-testid="config-group-list">
                  {displayItems.map((item) => {
                    const isSidVolume = isAudioMixer && isSidVolumeName(item.name);
                    const isSoloed = isSidVolume && soloState.soloItem === item.name;
                    const isMutedBySolo = isSidVolume && soloState.soloItem && soloState.soloItem !== item.name;
                    const testIdBase = item.name.toLowerCase().replace(/\s+/g, '-');
                    const rowClassName = cn(
                      isSidVolume && 'rounded-md px-2',
                      isSoloed && 'bg-primary/10',
                      isMutedBySolo && 'bg-muted/20',
                    );

                    const rightAccessory = isSidVolume ? (
                      <div className="flex items-center gap-3">
                        {isMutedBySolo && (
                          <span className="text-[11px] font-medium text-muted-foreground">Muted</span>
                        )}
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`solo-${item.name}`} className="text-[11px] uppercase tracking-wide">
                            Solo
                          </Label>
                          <Switch
                            id={`solo-${item.name}`}
                            checked={isSoloed}
                            aria-label={`Solo ${item.name}`}
                            onCheckedChange={() => dispatchSolo({ type: 'toggle', item: item.name })}
                            disabled={isEditingVolumes}
                            data-testid={`audio-mixer-solo-${testIdBase}`}
                          />
                        </div>
                      </div>
                    ) : undefined;

                    return (
                      <ConfigItemRow
                        key={item.name}
                        category={categoryName}
                        name={item.name}
                        value={item.value}
                        options={item.options}
                        details={item.details}
                        onValueChange={(v) =>
                          isSidVolume ? handleAudioValueChange(item.name, v) : handleValueChange(item.name, v)
                        }
                        isLoading={setConfig.isPending}
                        className={rowClassName}
                        rightAccessory={rightAccessory}
                        valueTestId={isSidVolume ? `audio-mixer-value-${testIdBase}` : undefined}
                        sliderTestId={isSidVolume ? `audio-mixer-slider-${testIdBase}` : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function ConfigBrowserPage() {
  const { status } = useC64Connection();
  const { data: categoriesData, isLoading } = useC64Categories();
  const [searchQuery, setSearchQuery] = useState('');
  const { setConfigExpanded } = useRefreshControl();
  const { isApplying, markChanged } = useAppConfigState();

  const filteredCategories = useMemo(() => {
    if (!categoriesData?.categories) return [];
    if (!searchQuery) return categoriesData.categories;
    
    return categoriesData.categories.filter((cat) =>
      cat.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [categoriesData?.categories, searchQuery]);

  return (
    <div className="min-h-screen pb-24">
      <AppBar
        title="Configuration"
        subtitle={
          <span>
            {categoriesData?.categories.length || 0} categories
            {isApplying ? <span className="ml-2 text-[11px] text-muted-foreground">Applying changes…</span> : null}
          </span>
        }
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </AppBar>

      <main className="container py-4 space-y-3">
        {!status.isConnected ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
            <p className="text-sm text-destructive font-medium">Not connected</p>
            <p className="text-xs text-muted-foreground mt-1">
              Configure connection in Settings
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? 'No categories match your search' : 'No categories available'}
          </div>
        ) : (
          filteredCategories.map((category, index) => (
            <motion.div
              key={category}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <CategorySection
                categoryName={category}
                onOpenChange={(isOpen) => setConfigExpanded(category, isOpen)}
                markChanged={markChanged}
              />
            </motion.div>
          ))
        )}
      </main>
    </div>
  );
}

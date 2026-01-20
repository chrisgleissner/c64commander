import { useState, useMemo, useEffect, useReducer, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Cpu, 
  Monitor, 
  Volume2, 
  HardDrive,
  ChevronDown,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { useC64Category, useC64SetConfig, useC64UpdateConfigBatch, useC64Connection } from '@/hooks/useC64Connection';
import { useAppConfigState } from '@/hooks/useAppConfigState';
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { isAudioMixerValueEqual, resolveAudioMixerResetValue } from '@/lib/config/audioMixer';
import { Button } from '@/components/ui/button';
import { useRefreshControl } from '@/hooks/useRefreshControl';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getC64API } from '@/lib/c64api';
import {
  buildSoloRoutingUpdates,
  isSidVolumeName,
  soloReducer,
  type AudioMixerVolumeItem,
} from '@/lib/config/audioMixerSolo';

type NormalizedConfigItem = {
  value: string | number;
  options?: string[];
  details?: {
    min?: number;
    max?: number;
    format?: string;
    presets?: string[];
  };
};

const normalizeConfigItem = (config: unknown): NormalizedConfigItem => {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { value: config as string | number };
  }

  const cfg = config as Record<string, any>;
  const selected =
    cfg.selected ??
    cfg.value ??
    cfg.current ??
    cfg.current_value ??
    cfg.currentValue ??
    cfg.default ??
    cfg.default_value ??
    '';

  const optionsCandidate = cfg.options ?? cfg.values ?? cfg.choices;
  const presetsCandidate = cfg.details?.presets ?? cfg.presets ?? cfg.values ?? cfg.choices;
  const options = Array.isArray(optionsCandidate) ? optionsCandidate : undefined;
  const presets = Array.isArray(presetsCandidate) ? presetsCandidate : undefined;

  const min = cfg.details?.min ?? cfg.min ?? cfg.minimum;
  const max = cfg.details?.max ?? cfg.max ?? cfg.maximum;
  const format = cfg.details?.format ?? cfg.format;

  const details =
    min !== undefined || max !== undefined || format || presets
      ? { min, max, format, presets }
      : undefined;

  return { value: selected, options, details };
};

interface QuickSection {
  id: string;
  title: string;
  icon: React.ElementType;
  category: string;
  itemFilter: (itemName: string) => boolean;
}

const quickSections: QuickSection[] = [
  {
    id: 'video',
    title: 'Video (VIC)',
    icon: Monitor,
    category: 'U64 Specific Settings',
    itemFilter: (name) => 
      name.includes('System Mode') || 
      name.includes('Video') || 
      name.includes('HDMI') ||
      name.includes('Palette'),
  },
  {
    id: 'audio',
    title: 'Audio (SID)',
    icon: Volume2,
    category: 'Audio Mixer',
    itemFilter: (name) => 
      name.includes('Vol ') || 
      name.includes('Pan '),
  },
  {
    id: 'sid-config',
    title: 'SID Configuration',
    icon: Volume2,
    category: 'UltiSID Configuration',
    itemFilter: () => true,
  },
  {
    id: 'cpu',
    title: 'CPU Settings',
    icon: Cpu,
    category: 'U64 Specific Settings',
    itemFilter: (name) => 
      name.includes('CPU') || 
      name.includes('Turbo') ||
      name.includes('Badline'),
  },
  {
    id: 'drive-a',
    title: 'Drive A',
    icon: HardDrive,
    category: 'Drive A Settings',
    itemFilter: () => true,
  },
  {
    id: 'drive-b',
    title: 'Drive B',
    icon: HardDrive,
    category: 'Drive B Settings',
    itemFilter: () => true,
  },
];

function QuickSectionCard({
  section,
  onOpenChange,
  markChanged,
}: {
  section: QuickSection;
  onOpenChange: (isOpen: boolean) => void;
  markChanged: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { status } = useC64Connection();
  const { data: categoryData, isLoading, refetch } = useC64Category(section.category, isOpen);
  const setConfig = useC64SetConfig();
  const updateConfigBatch = useC64UpdateConfigBatch();
  const isAudioMixer = section.category === 'Audio Mixer';
  const [soloState, dispatchSolo] = useReducer(soloReducer, { soloItem: null });
  const [audioConfiguredItems, setAudioConfiguredItems] = useState<
    Array<{ name: string; value: string | number; options?: string[]; details?: NormalizedConfigItem['details'] }>
  >([]);
  const audioConfiguredRef = useRef<AudioMixerVolumeItem[]>([]);
  const soloSnapshotRef = useRef<AudioMixerVolumeItem[]>([]);
  const wasSoloActiveRef = useRef(false);
  const soloSnapshotKey = 'c64u_audio_mixer_solo_snapshot';

  useEffect(() => {
    if (isOpen) {
      refetch();
    }
  }, [isOpen, refetch]);

  useEffect(() => {
    onOpenChange(isOpen);
  }, [isOpen, onOpenChange]);

  const items = useMemo(() => {
    if (!categoryData) return [];
    
    const catData = categoryData[section.category] as any;
    if (!catData || typeof catData !== 'object') return [];

    const itemsData = (catData as any).items ?? catData;
    
    return Object.entries(itemsData)
      .filter(([name]) => section.itemFilter(name))
      .map(([name, config]) => ({
        name,
        ...normalizeConfigItem(config),
      }));
  }, [categoryData, section.category, section.itemFilter]);

  useEffect(() => {
    if (!isAudioMixer) return;
    if (items.length === 0) {
      setAudioConfiguredItems([]);
      audioConfiguredRef.current = [];
      soloSnapshotRef.current = [];
      return;
    }
    if (!soloState.soloItem || audioConfiguredItems.length === 0) {
      setAudioConfiguredItems(items);
      audioConfiguredRef.current = items;
    }
    if (!soloState.soloItem) {
      soloSnapshotRef.current = items;
    }
  }, [isAudioMixer, items, soloState.soloItem, audioConfiguredItems.length]);

  useEffect(() => {
    if (!isAudioMixer) return;
    audioConfiguredRef.current = audioConfiguredItems;
  }, [isAudioMixer, audioConfiguredItems]);

  const applySoloRouting = useCallback(
    async (soloItem: string | null, configuredOverride?: AudioMixerVolumeItem[]) => {
      if (!isAudioMixer) return;
      const configured = configuredOverride && configuredOverride.length > 0
        ? configuredOverride
        : audioConfiguredRef.current;
      if (!configured.length) return;
      if (soloItem) {
        soloSnapshotRef.current = configured;
        try {
          sessionStorage.setItem(soloSnapshotKey, JSON.stringify(configured));
        } catch {
          // ignore storage failures
        }
      }
      const updates = buildSoloRoutingUpdates(configured, soloItem);
      if (Object.keys(updates).length === 0) return;
      try {
        const api = getC64API();
        await api.updateConfigBatch({ [section.category]: updates });
        if (!soloItem) {
          try {
            sessionStorage.removeItem(soloSnapshotKey);
          } catch {
            // ignore storage failures
          }
        }
      } catch (error) {
        addErrorLog('Solo routing update failed', {
          error: (error as Error).message,
          category: section.category,
          soloItem: soloItem ?? 'none',
        });
        toast({
          title: 'Audio routing error',
          description: (error as Error).message,
          variant: 'destructive',
        });
      }
    },
    [isAudioMixer, section.category],
  );

  useEffect(() => {
    if (!isAudioMixer) return;
    const isActive = Boolean(soloState.soloItem);
    if (isActive || wasSoloActiveRef.current) {
      void applySoloRouting(soloState.soloItem);
    }
    wasSoloActiveRef.current = isActive;
  }, [isAudioMixer, soloState.soloItem, applySoloRouting]);

  useEffect(() => {
    if (!isAudioMixer) return undefined;
    return () => {
      const configured = audioConfiguredRef.current.length
        ? audioConfiguredRef.current
        : (items as AudioMixerVolumeItem[]);
      let snapshot = soloSnapshotRef.current.length ? soloSnapshotRef.current : configured;
      try {
        const stored = sessionStorage.getItem(soloSnapshotKey);
        if (stored) {
          const parsed = JSON.parse(stored) as AudioMixerVolumeItem[];
          if (Array.isArray(parsed) && parsed.length) snapshot = parsed;
        }
      } catch {
        // ignore storage failures
      }
      if (snapshot.length) {
        void applySoloRouting(null, snapshot);
      }
    };
  }, [isAudioMixer, applySoloRouting, items]);

  const handleValueChange = async (itemName: string, value: string | number) => {
    try {
      await setConfig.mutateAsync({
        category: section.category,
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
    updateAudioConfiguredValue(itemName, value);
    await handleValueChange(itemName, value);
    if (!soloState.soloItem) {
      soloSnapshotRef.current = items;
    }
  };

  const resetAudioMixer = async () => {
    if (section.category !== 'Audio Mixer') return;
    setIsResetting(true);
    try {
      const updates: Record<string, string | number> = {};
      for (const item of items) {
        const target = await resolveAudioMixerResetValue(section.category, item.name, item.options);
        if (target === undefined) continue;
        if (isAudioMixerValueEqual(item.value, target)) continue;
        updates[item.name] = target;
      }

      if (Object.keys(updates).length === 0) {
        toast({ title: 'Audio Mixer already at defaults', description: 'No changes needed.' });
        return;
      }

      await updateConfigBatch.mutateAsync({ category: section.category, updates });
      markChanged();
      toast({ title: 'Audio Mixer reset', description: 'Volumes set to 0 dB, pans centered.' });
    } catch (error) {
      addErrorLog('Audio Mixer reset failed', {
        error: (error as Error).message,
        category: section.category,
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

  const Icon = section.icon;

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
        disabled={!status.isConnected}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <span className="font-medium">{section.title}</span>
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
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No settings available
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {displayItems.map((item) => {
                    const isSidVolume = isAudioMixer && isSidVolumeName(item.name);
                    const isSoloed = isSidVolume && soloState.soloItem === item.name;
                    const isMutedBySolo = isSidVolume && soloState.soloItem && soloState.soloItem !== item.name;
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
                          />
                        </div>
                      </div>
                    ) : undefined;

                    return (
                      <ConfigItemRow
                        key={item.name}
                        category={section.category}
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
                      />
                    );
                  })}
                </div>
              )}
              
              <div className="flex justify-between pt-2">
                {section.category === 'Audio Mixer' && (
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function QuickSettingsPage() {
  const { status } = useC64Connection();
  const { setQuickExpanded } = useRefreshControl();
  const { markChanged } = useAppConfigState();

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <div>
            <h1 className="c64-header text-xl">Quick Settings</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Important VIC, SID, CPU & Drive settings
            </p>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-4">
        {!status.isConnected ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
            <p className="text-sm text-destructive font-medium">Not connected</p>
            <p className="text-xs text-muted-foreground mt-1">
              Configure connection in Settings
            </p>
          </div>
        ) : (
          quickSections.map((section) => (
            <QuickSectionCard
              key={section.id}
              section={section}
              onOpenChange={(isOpen) => setQuickExpanded(section.id, isOpen)}
              markChanged={markChanged}
            />
          ))
        )}
      </main>
    </div>
  );
}

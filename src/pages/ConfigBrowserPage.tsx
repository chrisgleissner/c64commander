import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronDown, Loader2, RefreshCw, FolderOpen } from 'lucide-react';
import { useC64Categories, useC64Category, useC64SetConfig, useC64Connection } from '@/hooks/useC64Connection';
import { useAppConfigState } from '@/hooks/useAppConfigState';
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { useC64UpdateConfigBatch } from '@/hooks/useC64Connection';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { addErrorLog } from '@/lib/logging';
import { resolveAudioMixerResetValue } from '@/lib/config/audioMixer';
import { useRefreshControl } from '@/hooks/useRefreshControl';
import { isAudioMixerValueEqual } from '@/lib/config/audioMixer';

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
                  {items.map((item) => (
                    <ConfigItemRow
                      key={item.name}
                      category={categoryName}
                      name={item.name}
                      value={item.value}
                      options={item.options}
                      details={item.details}
                      onValueChange={(v) => handleValueChange(item.name, v)}
                      isLoading={setConfig.isPending}
                    />
                  ))}
                </div>
              )}
              
              <div className="flex justify-between pt-2">
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
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="c64-header text-xl">Configuration</h1>
              <p className="text-xs text-muted-foreground mt-1">
                {categoriesData?.categories.length || 0} categories
              </p>
              {isApplying && (
                <p className="text-[11px] text-muted-foreground mt-1">Applying changes…</p>
              )}
            </div>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </header>

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

import { useState, useMemo } from 'react';
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
import { useC64Category, useC64SetConfig, useC64Connection } from '@/hooks/useC64Connection';
import { ConfigItemRow } from '@/components/ConfigItemRow';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

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

function QuickSectionCard({ section }: { section: QuickSection }) {
  const [isOpen, setIsOpen] = useState(false);
  const { status } = useC64Connection();
  const { data: categoryData, isLoading, refetch } = useC64Category(section.category, isOpen);
  const setConfig = useC64SetConfig();

  const items = useMemo(() => {
    if (!categoryData) return [];
    
    const catData = categoryData[section.category];
    if (!catData || typeof catData !== 'object') return [];
    
    return Object.entries(catData)
      .filter(([name]) => section.itemFilter(name))
      .map(([name, config]) => {
        if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
          return {
            name,
            value: (config as any).selected ?? '',
            options: (config as any).options,
            details: (config as any).details,
          };
        }
        return {
          name,
          value: config as string | number,
          options: undefined,
          details: undefined,
        };
      });
  }, [categoryData, section.category, section.itemFilter]);

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

  const Icon = section.icon;

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
                  {items.map((item) => (
                    <ConfigItemRow
                      key={item.name}
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
              
              <div className="flex justify-end pt-2">
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

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <h1 className="c64-header text-xl">Quick Settings</h1>
          <p className="text-xs text-muted-foreground mt-1">
            High-value VIC, SID, CPU & Drive settings
          </p>
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
            <QuickSectionCard key={section.id} section={section} />
          ))
        )}
      </main>
    </div>
  );
}

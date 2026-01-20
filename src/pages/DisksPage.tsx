import { motion } from 'framer-motion';
import { useC64Connection } from '@/hooks/useC64Connection';
import { HomeDiskManager } from '@/components/disks/HomeDiskManager';
import { ConnectionBadge } from '@/components/ConnectionBadge';

export default function DisksPage() {
  const { status } = useC64Connection();

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="c64-header text-xl">Disks</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Drive control & disk library
              </p>
            </div>
            <ConnectionBadge status={status} />
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <HomeDiskManager />
        </motion.div>
      </main>
    </div>
  );
}

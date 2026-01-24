import { motion } from 'framer-motion';
import { HomeDiskManager } from '@/components/disks/HomeDiskManager';
import { AppBar } from '@/components/AppBar';

export default function DisksPage() {
  return (
    <div className="min-h-screen pb-24">
      <AppBar title="Disks" subtitle="Drive control & disk library" />

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

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { motion } from "framer-motion";
import { HomeDiskManager } from "@/components/disks/HomeDiskManager";
import { AppBar } from "@/components/AppBar";
import { PageContainer, PageStack } from "@/components/layout/PageContainer";

export default function DisksPage() {
  return (
    <div className="min-h-screen pb-24 pt-[var(--app-bar-height)]">
      <AppBar title="Disks" subtitle="Drive control & disk library" />

      <PageContainer>
        <PageStack>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <HomeDiskManager />
          </motion.div>
        </PageStack>
      </PageContainer>
    </div>
  );
}

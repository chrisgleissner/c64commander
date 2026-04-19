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
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { PageContainer, PageStack } from "@/components/layout/PageContainer";
import { LightingAutomationCue } from "@/components/lighting/LightingStudioDialog";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useLightingStudio } from "@/hooks/useLightingStudio";

export default function DisksPage() {
  const pageShellClassName = usePrimaryPageShellClassName();
  const { resolved, openStudio, openContextLens } = useLightingStudio();
  const { value: lightingStudioEnabled } = useFeatureFlag("lighting_studio_enabled");
  return (
    <div className={pageShellClassName}>
      <AppBar title="Disks" />

      <PageContainer>
        <PageStack>
          {lightingStudioEnabled && resolved.sourceCue?.bucket === "disks" ? (
            <LightingAutomationCue
              label={resolved.sourceCue.label}
              onOpenStudio={openStudio}
              onOpenContextLens={openContextLens}
            />
          ) : null}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <HomeDiskManager />
          </motion.div>
        </PageStack>
      </PageContainer>
    </div>
  );
}

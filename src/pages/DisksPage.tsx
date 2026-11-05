/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { motion } from "framer-motion";
import { Lightbulb } from "lucide-react";
import { HomeDiskManager } from "@/components/disks/HomeDiskManager";
import { AppBar } from "@/components/AppBar";
import { CollapsibleSection } from "@/components/CollapsibleSection";
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
            <CollapsibleSection
              scope="disks"
              id="lighting-cue"
              title="Lighting automation"
              summary={resolved.sourceCue.label}
              icon={Lightbulb}
              testId="disks-lighting-cue"
            >
              <div className="p-4 pt-0">
                <LightingAutomationCue
                  label={resolved.sourceCue.label}
                  onOpenStudio={openStudio}
                  onOpenContextLens={openContextLens}
                />
              </div>
            </CollapsibleSection>
          ) : null}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <HomeDiskManager />
          </motion.div>
        </PageStack>
      </PageContainer>
    </div>
  );
}

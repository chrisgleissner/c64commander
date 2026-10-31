/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Headphones } from "lucide-react";
import { DeviceLessChoices } from "@/components/appMode/DeviceLessChoices";
import { HelperText } from "@/components/ui/HelperText";
import { MODE_COPY } from "@/lib/appMode/copy";
import { SettingsSection } from "@/pages/settings/SettingsSection";

export function AppModeSettingsSection() {
  return (
    <SettingsSection
      id="app-mode"
      title={MODE_COPY.settings.title}
      summary={MODE_COPY.settings.summary}
      icon={Headphones}
      testId="settings-section-app-mode"
    >
      <div className="space-y-3">
        <HelperText>{MODE_COPY.settings.description}</HelperText>
        <DeviceLessChoices />
      </div>
    </SettingsSection>
  );
}

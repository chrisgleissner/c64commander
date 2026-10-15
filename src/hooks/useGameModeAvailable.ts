/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useConnectionState } from "@/hooks/useConnectionState";
import { useFeatureFlagValue } from "@/hooks/useFeatureFlags";
import { deviceSupportsGameMode } from "@/lib/remoteInput/gameModeLaunch";

/** Whether the keypad shortcut, the Quick menu, the function keys and the Play page may start Game Mode. */
export const useGameModeAvailable = (): boolean => {
  const remoteInputEnabled = useFeatureFlagValue("remote_input_enabled");
  const { deviceInfo } = useConnectionState();
  return remoteInputEnabled && deviceSupportsGameMode(deviceInfo);
};

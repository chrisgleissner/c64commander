/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { AppMode } from "@/lib/appMode/appModeStore";
import { isSurfaceVisible } from "@/lib/appMode/surfaces";
import { requestDeviceSwitcherOpen, requestMachineCommand } from "@/lib/input/keypadCommands";

export type DeviceKeypadShortcuts = {
  openDeviceSwitcher?: () => void;
  machinePauseResume?: () => void;
  machineReset?: () => void;
};

/** The keypad shortcuts that act on a machine or switch between machines; none exist without a device. */
export const deviceKeypadShortcuts = (appMode: AppMode): DeviceKeypadShortcuts => ({
  openDeviceSwitcher: isSurfaceVisible("quick-menu:switch-device", appMode)
    ? () => requestDeviceSwitcherOpen()
    : undefined,
  machinePauseResume: isSurfaceVisible("quick-menu:machine-pause", appMode)
    ? () => requestMachineCommand("pauseResume")
    : undefined,
  machineReset: isSurfaceVisible("quick-menu:machine-reset", appMode)
    ? () => requestMachineCommand("reset")
    : undefined,
});

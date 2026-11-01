/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { deviceKeypadShortcuts } from "@/lib/appMode/deviceKeypadShortcuts";
import { subscribeMachineCommand } from "@/lib/input/keypadCommands";

describe("deviceKeypadShortcuts", () => {
  it("SPM-QM-01 the machine and device-switcher shortcuts are undefined in SID Player", () => {
    expect(deviceKeypadShortcuts("sid-player")).toEqual({
      openDeviceSwitcher: undefined,
      machinePauseResume: undefined,
      machineReset: undefined,
    });
  });

  it("SPM-QM-01 the Full App wires them to the machine commands", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeMachineCommand((command) => {
      seen.push(command);
      return true;
    });
    const shortcuts = deviceKeypadShortcuts("full");
    shortcuts.machinePauseResume?.();
    shortcuts.machineReset?.();
    unsubscribe();
    expect(seen).toEqual(["pauseResume", "reset"]);
    expect(typeof shortcuts.openDeviceSwitcher).toBe("function");
  });
});

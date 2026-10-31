/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearDedupStateForTests, reportUserError } from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { SidPlayerTrafficBlockedError } from "@/lib/appMode/deviceTrafficGate";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: vi.fn(() => ({ devices: [], selectedDeviceId: null })),
}));

describe("reportUserError in SID Player", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearDedupStateForTests();
    localStorage.clear();
    saveStartupModeByUser("default");
  });

  it("SPM-ERR-01 a refused device call logs at info and raises no toast", () => {
    saveStartupModeByUser("sid-player");
    reportUserError({
      operation: "CONFIG_LOAD",
      title: "Load failed",
      description: "SID Player blocked device traffic: rest",
      error: new SidPlayerTrafficBlockedError("rest", { host: "c64u" }),
    });

    expect(toast).not.toHaveBeenCalled();
    expect(addErrorLog).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "CONFIG_LOAD: Load failed",
      expect.objectContaining({ suppressedReason: "sid-player-no-device" }),
    );
  });

  it("SPM-ERR-01 SID Player logs a connectivity failure without a toast", () => {
    saveStartupModeByUser("sid-player");
    reportUserError({
      operation: "PLAY",
      title: "Playback failed",
      description: "Device not connected. Check connection settings.",
      error: new Error("Host unreachable"),
    });

    expect(toast).not.toHaveBeenCalled();
    expect(addErrorLog).not.toHaveBeenCalled();
  });

  it("SPM-ERR-01 SID Player still reports an ordinary failure", () => {
    saveStartupModeByUser("sid-player");
    reportUserError({
      operation: "HVSC_INSTALL",
      title: "Install failed",
      description: "The archive is corrupt.",
      error: new Error("bad zip"),
    });

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("SPM-ERR-01 the Full App still raises a toast for a refused call", () => {
    reportUserError({
      operation: "CONFIG_LOAD",
      title: "Load failed",
      description: "x",
      error: new SidPlayerTrafficBlockedError("rest", {}),
    });

    expect(toast).toHaveBeenCalledTimes(1);
  });
});

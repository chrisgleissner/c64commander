/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearDedupStateForTests } from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";
import { addErrorLog } from "@/lib/logging";
import { clearConnectionSaveRefusal, reportConnectionSaveRefused } from "@/pages/settings/connectionSaveRefusal";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: vi.fn(() => ({ devices: [], selectedDeviceId: null })),
}));

const dismissals: Array<ReturnType<typeof vi.fn>> = [];

describe("connectionSaveRefusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearDedupStateForTests();
    dismissals.length = 0;
    vi.mocked(toast).mockImplementation((() => {
      const dismiss = vi.fn();
      dismissals.push(dismiss);
      return { id: `toast-${dismissals.length}`, dismiss, update: vi.fn() };
    }) as unknown as typeof toast);
  });

  it("shows the reason in an error toast and logs it", () => {
    reportConnectionSaveRefused("FTP port must be 1 to 65535.", "c64u");

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Connection not saved",
        description: "FTP port must be 1 to 65535.",
        variant: "destructive",
      }),
    );
    expect(addErrorLog).toHaveBeenCalledWith(
      "CONNECTION_SAVE_REFUSED: Connection not saved",
      expect.objectContaining({ description: "FTP port must be 1 to 65535." }),
    );
  });

  it("replaces the toast of an earlier refusal instead of stacking a second one", () => {
    reportConnectionSaveRefused("Device name must be unique.", "c64u");
    reportConnectionSaveRefused("FTP port must be 1 to 65535.", "c64u");

    expect(dismissals[0]).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ description: "FTP port must be 1 to 65535." }));
  });

  it("dismisses the refusal toast when the save later succeeds", () => {
    reportConnectionSaveRefused("Device name must be unique.", "c64u");

    clearConnectionSaveRefusal("c64u");

    expect(dismissals[0]).toHaveBeenCalledTimes(1);
  });

  it("leaves the refusal toast of another device alone", () => {
    reportConnectionSaveRefused("Device name must be unique.", "c64u");

    clearConnectionSaveRefusal("u2");

    expect(dismissals[0]).not.toHaveBeenCalled();
  });
});

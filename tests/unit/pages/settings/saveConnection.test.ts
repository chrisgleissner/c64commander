/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateNewDeviceReachability } from "@/lib/connection/addDeviceReachability";
import { setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { buildSavedDeviceEditorDraft } from "@/lib/savedDevices/deviceEditor";
import {
  getSavedDevicesSnapshot,
  removeSavedDevice,
  resetSavedDevicesCacheForTests,
  selectSavedDevice,
  type SavedDevice,
} from "@/lib/savedDevices/store";
import { clearPasswordForDevice, setPasswordForDevice } from "@/lib/secureStorage";
import { setStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { isConnectionSaveInFlight, saveConnection, type SaveConnectionContext } from "@/pages/settings/saveConnection";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/connection/addDeviceReachability", () => ({ evaluateNewDeviceReachability: vi.fn() }));
vi.mock("@/lib/ftp/ftpConfig", () => ({ setStoredFtpPort: vi.fn(), getStoredFtpPort: vi.fn(() => 21) }));
vi.mock("@/lib/telnet/telnetConfig", () => ({ setStoredTelnetPort: vi.fn(), getStoredTelnetPort: vi.fn(() => 64) }));
vi.mock("@/lib/secureStorage", () => ({
  getPasswordForDevice: vi.fn(async () => null),
  setPasswordForDevice: vi.fn(async () => undefined),
  clearPasswordForDevice: vi.fn(async () => undefined),
}));

const STORAGE_KEY = "c64u_saved_devices:v1";

const buildDevice = (id: string, name: string, host: string): SavedDevice =>
  ({
    id,
    name,
    nameSource: "USER",
    host,
    type: "U64",
    typeSource: "INFERRED",
    httpPort: 80,
    ftpPort: 21,
    telnetPort: 64,
    lastKnownProduct: null,
    lastKnownHostname: null,
    lastKnownUniqueId: null,
    lastSuccessfulConnectionAt: null,
    lastUsedAt: null,
    hasPassword: false,
  }) as SavedDevice;

const seedStore = () => {
  localStorage.clear();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      selectedDeviceId: "device-a",
      devices: [buildDevice("device-a", "Alpha", "alpha"), buildDevice("device-b", "Beta", "beta")],
      summaries: {},
      summaryLru: [],
    }),
  );
  resetSavedDevicesCacheForTests();
};

const deviceById = (id: string) => getSavedDevicesSnapshot().devices.find((device) => device.id === id);

const buildContext = (overrides: Partial<SaveConnectionContext> = {}): SaveConnectionContext => {
  const device = deviceById("device-a")!;
  return {
    device,
    draft: { ...buildSavedDeviceEditorDraft(device), host: "192.0.2.50", ftpPort: "2121", telnetPort: "6464" },
    passwordEditing: false,
    typedPassword: "",
    isConnected: true,
    editor: {
      setHostnameError: vi.fn(),
      setDeviceNameError: vi.fn(),
      setConnectionFieldError: vi.fn(),
      setPasswordError: vi.fn(),
      setReachabilitySuggestion: vi.fn(),
      finishSave: vi.fn(),
    },
    report: { invalid: vi.fn(), refused: vi.fn(), failed: vi.fn(), dismiss: vi.fn() },
    updateConfig: vi.fn(),
    switchSavedDevice: vi.fn(async () => undefined),
    ...overrides,
  };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("saveConnection against the real saved devices store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
    vi.mocked(evaluateNewDeviceReachability).mockResolvedValue({ status: "reachable" } as never);
  });

  it("stores the ports and connects when the edited device is still the selected one", async () => {
    const context = buildContext();

    await saveConnection(context);

    expect(setStoredFtpPort).toHaveBeenCalledWith(2121);
    expect(setStoredTelnetPort).toHaveBeenCalledWith(6464);
    expect(deviceById("device-a")).toMatchObject({ host: "192.0.2.50", ftpPort: 2121, telnetPort: 6464 });
    expect(context.updateConfig).toHaveBeenCalledWith("192.0.2.50", undefined);
    expect(context.switchSavedDevice).toHaveBeenCalledWith("device-a");
  });

  it("keeps its ports away from the device selected while the device was asked", async () => {
    const probe = deferred<unknown>();
    vi.mocked(evaluateNewDeviceReachability).mockReturnValue(probe.promise as never);
    const context = buildContext();
    const saving = saveConnection(context);

    selectSavedDevice("device-b");
    probe.resolve({ status: "reachable" });
    await saving;

    expect(setStoredFtpPort).not.toHaveBeenCalled();
    expect(setStoredTelnetPort).not.toHaveBeenCalled();
    expect(deviceById("device-a")).toMatchObject({ host: "192.0.2.50", ftpPort: 2121, telnetPort: 6464 });
    expect(deviceById("device-b")).toMatchObject({ ftpPort: 21, telnetPort: 64 });
    expect(context.updateConfig).not.toHaveBeenCalled();
    expect(context.switchSavedDevice).not.toHaveBeenCalled();
    expect(context.editor.finishSave).not.toHaveBeenCalled();
  });

  it("does not connect when another device was selected while the new password was being stored", async () => {
    const storing = deferred<void>();
    vi.mocked(setPasswordForDevice).mockReturnValueOnce(storing.promise);
    const context = buildContext({ passwordEditing: true, typedPassword: "new-password" });
    const saving = saveConnection(context);
    await vi.waitFor(() => expect(setPasswordForDevice).toHaveBeenCalled());

    selectSavedDevice("device-b");
    storing.resolve();
    await saving;

    expect(context.updateConfig).not.toHaveBeenCalled();
    expect(context.switchSavedDevice).not.toHaveBeenCalled();
    expect(setStoredFtpPort).not.toHaveBeenCalled();
  });

  it("removes the password it stored for a device that was deleted while the password was being stored", async () => {
    const storing = deferred<void>();
    vi.mocked(setPasswordForDevice).mockReturnValueOnce(storing.promise);
    const context = buildContext({ passwordEditing: true, typedPassword: "new-password" });
    const saving = saveConnection(context);
    await vi.waitFor(() => expect(setPasswordForDevice).toHaveBeenCalled());

    selectSavedDevice("device-b");
    removeSavedDevice("device-a");
    storing.resolve();
    await saving;

    expect(clearPasswordForDevice).toHaveBeenCalledWith("device-a");
    expect(context.updateConfig).not.toHaveBeenCalled();
    expect(deviceById("device-a")).toBeUndefined();
  });

  it("reports a save as in flight from any page instance until the device has answered", async () => {
    const probe = deferred<unknown>();
    vi.mocked(evaluateNewDeviceReachability).mockReturnValue(probe.promise as never);
    const saving = saveConnection(buildContext());
    expect(isConnectionSaveInFlight()).toBe(true);

    probe.resolve({ status: "reachable" });
    await saving;

    expect(isConnectionSaveInFlight()).toBe(false);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * Applying a settings file drives the device's own menu over Telnet, because no REST endpoint loads
 * a `.cfg`. On this rig a machine reboot part-way through left the app waiting for a menu that
 * never answered: the Play page disables itself while a launch is in flight, so every control on it
 * was dead with nothing on screen saying why, until the app was restarted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applyRemoteSnapshot = vi.fn();
const applyLocalSnapshot = vi.fn();

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ updateConfigBatch: vi.fn() }),
  resolveDeviceHostFromStorage: () => "c64u",
}));
vi.mock("@/lib/c64api/hostConfig", () => ({ stripPortFromDeviceHost: (host: string) => host }));
vi.mock("@/lib/config/configTelnetWorkflow", () => ({
  applyRemoteConfigFromPath: vi.fn(),
  applyRemoteConfigFromTemp: vi.fn(),
  saveRemoteConfigFromTemp: vi.fn(),
}));
vi.mock("@/lib/config/configWorkflow", () => ({
  createConfigWorkflow: () => ({ applyRemoteSnapshot, applyLocalSnapshot }),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));
vi.mock("@/lib/ftp/ftpClient", () => ({ listFtpDirectory: vi.fn(), readFtpFile: vi.fn(), writeFtpFile: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  withTelnetInteraction: vi.fn(async (_options: unknown, run: () => Promise<void>) => run()),
}));
vi.mock("@/lib/playback/fileLibraryUtils", () => ({
  buildLocalPlayFileFromTree: vi.fn(),
  buildLocalPlayFileFromUri: vi.fn(),
}));
vi.mock("@/lib/playback/localFileBrowser", () => ({ getParentPath: (path: string) => path }));
vi.mock("@/lib/secureStorage", () => ({ getPassword: async () => "" }));
vi.mock("@/lib/sid/sidUtils", () => ({ base64ToUint8: () => new Uint8Array() }));
vi.mock("@/lib/sourceNavigation/localSourceAdapter", () => ({
  resolveLocalRuntimeFile: () => ({ arrayBuffer: async () => new ArrayBuffer(4) }),
}));
vi.mock("@/lib/telnet/telnetClient", () => ({ createTelnetClient: vi.fn() }));
vi.mock("@/lib/telnet/telnetConfig", () => ({ getStoredTelnetPort: () => 23 }));
vi.mock("@/lib/telnet/telnetSession", () => ({ createTelnetSession: vi.fn() }));
vi.mock("@/lib/telnet/telnetTypes", () => ({ resolveTelnetMenuKey: () => "F5" }));
vi.mock("@/lib/tracing/actionTrace", () => ({
  runWithImplicitAction: vi.fn(async (_id: string, run: (action: unknown) => Promise<void>) => run(null)),
}));

const ultimateRef = {
  kind: "ultimate" as const,
  fileName: "Game.cfg",
  path: "/Usb0/Games/Game.cfg",
  modifiedAt: null,
  sizeBytes: null,
};

const options = {
  configRef: ultimateRef,
  configOverrides: null,
  deviceProduct: "C64 Ultimate",
  localEntriesBySourceId: new Map(),
  localSourceTreeUris: new Map(),
};

describe("when the device stops answering its menu mid-apply", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    applyRemoteSnapshot.mockReset();
    applyLocalSnapshot.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up after the deadline instead of waiting forever", async () => {
    const { applyConfigFileReference, CONFIG_APPLICATION_DEADLINE_MS } =
      await import("@/lib/config/applyConfigFileReference");
    applyRemoteSnapshot.mockImplementation(() => new Promise(() => {}));

    const attempt = applyConfigFileReference(options);
    const settled = expect(attempt).rejects.toThrow(/did not finish/);
    await vi.advanceTimersByTimeAsync(CONFIG_APPLICATION_DEADLINE_MS + 1);
    await settled;
  });

  it("names the file and the time it waited, so the failure says what happened", async () => {
    const { applyConfigFileReference, CONFIG_APPLICATION_DEADLINE_MS } =
      await import("@/lib/config/applyConfigFileReference");
    applyRemoteSnapshot.mockImplementation(() => new Promise(() => {}));

    const attempt = applyConfigFileReference(options).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(CONFIG_APPLICATION_DEADLINE_MS + 1);
    const message = await attempt;
    expect(message).toContain("Game.cfg");
    expect(message).toContain(`${Math.round(CONFIG_APPLICATION_DEADLINE_MS / 1000)}s`);
  });

  it("leaves an application that finishes in time alone", async () => {
    const { applyConfigFileReference } = await import("@/lib/config/applyConfigFileReference");
    applyRemoteSnapshot.mockResolvedValue(undefined);

    await expect(applyConfigFileReference(options)).resolves.toBeUndefined();
    expect(applyRemoteSnapshot).toHaveBeenCalledWith("/Usb0/Games/Game.cfg");
  });

  /* A file the user picked off the phone goes through the same menu walk and the same deadline. */
  it("bounds a settings file that came from the phone too", async () => {
    const { applyConfigFileReference, CONFIG_APPLICATION_DEADLINE_MS } =
      await import("@/lib/config/applyConfigFileReference");
    applyLocalSnapshot.mockImplementation(() => new Promise(() => {}));

    const attempt = applyConfigFileReference({
      ...options,
      configRef: { kind: "local", fileName: "Local.cfg", path: "/Local.cfg", sourceId: "phone", uri: null },
    }).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(CONFIG_APPLICATION_DEADLINE_MS + 1);
    expect(await attempt).toContain("Local.cfg");
  });

  /* A deadline long enough to cut a slow but healthy application short would be its own defect. */
  it("waits well past the time a healthy application takes", async () => {
    const { CONFIG_APPLICATION_DEADLINE_MS } = await import("@/lib/config/applyConfigFileReference");
    expect(CONFIG_APPLICATION_DEADLINE_MS).toBeGreaterThanOrEqual(60_000);
  });
});

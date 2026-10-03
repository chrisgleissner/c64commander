/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type WorkflowDeps = {
  listRemoteTempFiles: () => Promise<Array<{ name: string; path: string }>>;
  readRemoteFile: (path: string) => Promise<Uint8Array>;
  writeRemoteFile: (path: string, bytes: Uint8Array) => Promise<void>;
  runSaveRemoteConfig: () => Promise<void>;
  runApplyRemoteConfig: (fileName: string) => Promise<void>;
};

const harness = vi.hoisted(() => ({
  deps: null as null | WorkflowDeps,
  applyRemoteSnapshot: vi.fn<(path: string) => Promise<void>>(),
  updateConfigBatch: vi.fn<(payload: unknown) => Promise<void>>(),
  session: null as null | {
    connected: boolean;
    keys: string[];
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  },
}));
const ftp = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), write: vi.fn() }));
const telnet = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn() }));
const logs = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
const secrets = vi.hoisted(() => ({ password: "pw" as string | null }));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ updateConfigBatch: harness.updateConfigBatch }),
  resolveDeviceHostFromStorage: () => "c64u",
}));
vi.mock("@/lib/c64api/hostConfig", () => ({ stripPortFromDeviceHost: (host: string) => host }));
vi.mock("@/lib/config/configTelnetWorkflow", () => ({
  applyRemoteConfigFromTemp: (...args: unknown[]) => telnet.apply(...args),
  saveRemoteConfigFromTemp: (...args: unknown[]) => telnet.save(...args),
}));
vi.mock("@/lib/config/configWorkflow", () => ({
  createConfigWorkflow: (deps: WorkflowDeps) => {
    harness.deps = deps;
    return {
      applyRemoteSnapshot: (path: string) => harness.applyRemoteSnapshot(path),
      applyLocalSnapshot: vi.fn(),
    };
  },
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));
vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: (...args: unknown[]) => ftp.list(...args),
  readFtpFile: (...args: unknown[]) => ftp.read(...args),
  writeFtpFile: (...args: unknown[]) => ftp.write(...args),
}));
vi.mock("@/lib/logging", () => logs);
vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  withTelnetInteraction: vi.fn(async (_options: unknown, run: () => Promise<void>) => run()),
}));
vi.mock("@/lib/secureStorage", () => ({ getPassword: async () => secrets.password }));
vi.mock("@/lib/telnet/telnetClient", () => ({ createTelnetClient: vi.fn() }));
vi.mock("@/lib/telnet/telnetConfig", () => ({ getStoredTelnetPort: () => 23 }));
vi.mock("@/lib/telnet/telnetSession", () => ({
  createTelnetSession: () => {
    const session = {
      connected: false,
      keys: [] as string[],
      connect: vi.fn(async () => {
        session.connected = true;
      }),
      disconnect: vi.fn(async () => {
        session.connected = false;
      }),
      isConnected: () => session.connected,
      sendKey: vi.fn(async (key: string) => {
        session.keys.push(key);
      }),
      sendRaw: vi.fn(async () => undefined),
      readScreen: vi.fn(async () => ({ cells: [], menus: [], screenType: "unknown" })),
    };
    harness.session = session;
    return session;
  },
}));
vi.mock("@/lib/tracing/actionTrace", () => ({
  runWithImplicitAction: vi.fn(async (_id: string, run: (action: unknown) => Promise<void>) => run(null)),
}));

import { applyConfigFileReference } from "@/lib/config/applyConfigFileReference";
import { cancelActiveConfigApply, ConfigApplyCancelledError } from "@/lib/config/configApplyCancellation";

const remoteRef = {
  kind: "ultimate" as const,
  fileName: "Game.cfg",
  path: "/Usb0/Game.cfg",
  modifiedAt: null,
  sizeBytes: null,
};

const baseOptions = {
  deviceProduct: "C64 Ultimate",
  localEntriesBySourceId: new Map(),
  localSourceTreeUris: new Map(),
};

describe("applyConfigFileReference against the device's FTP and Telnet", () => {
  beforeEach(() => {
    harness.deps = null;
    harness.session = null;
    harness.applyRemoteSnapshot.mockReset();
    harness.updateConfigBatch.mockReset();
    ftp.list.mockReset();
    ftp.read.mockReset();
    ftp.write.mockReset();
    telnet.save.mockReset();
    telnet.apply.mockReset();
    logs.addLog.mockReset();
    logs.addErrorLog.mockReset();
    secrets.password = "pw";
  });

  it("does nothing on the device when there is neither a file nor an override", async () => {
    await applyConfigFileReference({ ...baseOptions, configRef: null, configOverrides: [] });
    await applyConfigFileReference({ ...baseOptions, configRef: null });

    expect(harness.deps).toBeNull();
    expect(harness.updateConfigBatch).not.toHaveBeenCalled();
    expect(ftp.list).not.toHaveBeenCalled();
  });

  it("lists only the files in /Temp and round-trips file bytes over FTP as base64", async () => {
    ftp.list.mockResolvedValue({
      entries: [
        { type: "file", name: "a.cfg", path: "/Temp/a.cfg", size: 10, modifiedAt: "2026-10-02" },
        { type: "dir", name: "sub", path: "/Temp/sub", size: 0, modifiedAt: null },
      ],
    });
    ftp.read.mockResolvedValue({ data: btoa("\x01\x02\xff") });
    ftp.write.mockResolvedValue(undefined);
    let listed: unknown;
    let read: Uint8Array | undefined;
    harness.applyRemoteSnapshot.mockImplementation(async () => {
      listed = await harness.deps!.listRemoteTempFiles();
      read = await harness.deps!.readRemoteFile("/Temp/a.cfg");
      await harness.deps!.writeRemoteFile("/Temp/b.cfg", new Uint8Array([0x41, 0x42]));
    });

    await applyConfigFileReference({ ...baseOptions, configRef: remoteRef, configOverrides: null });

    expect(ftp.list).toHaveBeenCalledWith(expect.objectContaining({ host: "c64u", port: 21, path: "/Temp" }));
    expect(listed).toEqual([{ name: "a.cfg", path: "/Temp/a.cfg", size: 10, modifiedAt: "2026-10-02" }]);
    expect(Array.from(read!)).toEqual([0x01, 0x02, 0xff]);
    expect(ftp.write).toHaveBeenCalledWith(expect.objectContaining({ path: "/Temp/b.cfg", data: btoa("AB") }));
  });

  it("saves the device's settings through a Telnet session it then closes", async () => {
    harness.applyRemoteSnapshot.mockImplementation(async () => {
      await harness.deps!.runSaveRemoteConfig();
    });

    await applyConfigFileReference({ ...baseOptions, configRef: remoteRef, configOverrides: null });

    expect(telnet.save).toHaveBeenCalledWith(expect.anything(), "F1");
    expect(harness.session!.connect).toHaveBeenCalledWith("c64u", 23, "pw");
    expect(harness.session!.disconnect).toHaveBeenCalledTimes(1);
  });

  it("backs out of the device menu when a Telnet step fails on a live connection", async () => {
    telnet.apply.mockRejectedValue(new Error("menu item not found"));
    harness.applyRemoteSnapshot.mockImplementation(async () => {
      await harness.deps!.runApplyRemoteConfig("Game.cfg");
    });

    await expect(
      applyConfigFileReference({ ...baseOptions, configRef: remoteRef, configOverrides: null }),
    ).rejects.toThrow("menu item not found");

    expect(harness.session!.keys.slice(-2)).toEqual(["ESCAPE", "LEFT"]);
    expect(harness.session!.disconnect).toHaveBeenCalledTimes(1);
  });

  it("sends no keys when the Telnet connection was already lost", async () => {
    telnet.apply.mockImplementation(async () => {
      harness.session!.connected = false;
      throw new Error("connection reset");
    });
    harness.applyRemoteSnapshot.mockImplementation(async () => {
      await harness.deps!.runApplyRemoteConfig("Game.cfg");
    });

    await expect(
      applyConfigFileReference({ ...baseOptions, configRef: remoteRef, configOverrides: null }),
    ).rejects.toThrow("connection reset");

    expect(harness.session!.keys).toEqual([]);
  });

  it("writes overrides as one batch grouped by category", async () => {
    harness.updateConfigBatch.mockResolvedValue(undefined);

    await applyConfigFileReference({
      ...baseOptions,
      configRef: null,
      configOverrides: [
        { category: "Audio Mixer", item: "Vol UltiSid 1", value: "0 dB" },
        { category: "Audio Mixer", item: "Vol UltiSid 2", value: "-1 dB" },
        { category: "U64 Specific Settings", item: "System Mode", value: "PAL" },
      ],
    });

    expect(harness.updateConfigBatch).toHaveBeenCalledWith({
      "Audio Mixer": { "Vol UltiSid 1": "0 dB", "Vol UltiSid 2": "-1 dB" },
      "U64 Specific Settings": { "System Mode": "PAL" },
    });
    expect(logs.addLog).toHaveBeenCalledWith(
      "info",
      "Applying playback config overrides",
      expect.objectContaining({ overrideCount: 3, categories: ["Audio Mixer", "U64 Specific Settings"] }),
    );
  });

  it("logs a failed apply as an error with the file it was applying", async () => {
    harness.applyRemoteSnapshot.mockRejectedValue(new Error("FTP read failed"));

    await expect(
      applyConfigFileReference({ ...baseOptions, configRef: remoteRef, configOverrides: null }),
    ).rejects.toThrow("FTP read failed");

    expect(logs.addErrorLog).toHaveBeenCalledWith(
      "Playback config application failed",
      expect.objectContaining({ fileName: "Game.cfg", configKind: "ultimate", overrideCount: 0 }),
    );
  });

  it("logs a Stop during the apply as a cancellation, not as a failure", async () => {
    let releaseApply: () => void = () => undefined;
    harness.applyRemoteSnapshot.mockImplementation(() => new Promise<void>((resolve) => (releaseApply = resolve)));

    const outcome = applyConfigFileReference({
      ...baseOptions,
      configRef: remoteRef,
      configOverrides: [{ category: "Audio Mixer", item: "Vol UltiSid 1", value: "0 dB" }],
    }).catch((error: Error) => error);
    await vi.waitFor(() => expect(harness.applyRemoteSnapshot).toHaveBeenCalled());
    const stop = cancelActiveConfigApply();
    releaseApply();
    await stop;

    expect(await outcome).toBeInstanceOf(ConfigApplyCancelledError);
    expect(harness.updateConfigBatch).not.toHaveBeenCalled();
    expect(logs.addLog).toHaveBeenCalledWith("info", "Playback config application canceled by Stop", {
      fileName: "Game.cfg",
    });
    expect(logs.addErrorLog).not.toHaveBeenCalled();
  });

  it("connects to Telnet without a password when none is stored", async () => {
    secrets.password = null;
    harness.applyRemoteSnapshot.mockImplementation(async () => {
      await harness.deps!.runSaveRemoteConfig();
    });

    await applyConfigFileReference({ ...baseOptions, configRef: remoteRef, configOverrides: null });

    expect(harness.session!.connect).toHaveBeenCalledWith("c64u", 23, undefined);
    expect(ftp.list).not.toHaveBeenCalled();
  });

  it("logs a failed override write with no file name when only overrides were applied", async () => {
    harness.updateConfigBatch.mockRejectedValue(new Error("HTTP 500"));

    await expect(
      applyConfigFileReference({
        ...baseOptions,
        configRef: null,
        configOverrides: [{ category: "Audio Mixer", item: "Vol UltiSid 1", value: "0 dB" }],
      }),
    ).rejects.toThrow("HTTP 500");

    expect(logs.addErrorLog).toHaveBeenCalledWith("Playback config application failed", {
      fileName: null,
      configKind: null,
      overrideCount: 1,
      error: "HTTP 500",
    });
  });

  it("cancels an overrides-only apply that Stop reaches before the write", async () => {
    const outcome = applyConfigFileReference({
      ...baseOptions,
      configRef: null,
      configOverrides: [{ category: "Audio Mixer", item: "Vol UltiSid 1", value: "0 dB" }],
    }).catch((error: Error) => error);
    await cancelActiveConfigApply();

    expect(await outcome).toBeInstanceOf(ConfigApplyCancelledError);
    expect(harness.updateConfigBatch).not.toHaveBeenCalled();
    expect(logs.addLog).toHaveBeenCalledWith("info", "Playback config application canceled by Stop", {
      fileName: null,
    });
  });
});

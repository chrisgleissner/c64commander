/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  assertDeviceTrafficAllowed,
  MODE_SWITCH_GRACE_MS,
  resetDeviceTrafficGateForTests,
  SidPlayerTrafficBlockedError,
  type DeviceTrafficChannel,
} from "@/lib/appMode/deviceTrafficGate";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

const mockNative = vi.hoisted(() => ({
  ftp: {
    listDirectory: vi.fn(async () => ({ entries: [] })),
    listDirectoryRecursive: vi.fn(async () => ({ entries: [] })),
    readFile: vi.fn(async () => ({ data: "" })),
    writeFile: vi.fn(async () => ({ size: 0 })),
    makeDirectory: vi.fn(async () => ({ created: true })),
    pingFtp: vi.fn(async () => ({ ok: true })),
    cancelRead: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: async () => undefined })),
  },
  telnetConnect: vi.fn(async () => undefined),
  discover: vi.fn(async () => ({ candidates: [], scannedHosts: 0, elapsedMs: 0 })),
}));

vi.mock("@capacitor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capacitor/core")>()),
  registerPlugin: (name: string) => {
    if (name === "FtpClient") return mockNative.ftp;
    if (name === "TelnetSocket")
      return { connect: mockNative.telnetConnect, disconnect: vi.fn(), send: vi.fn(), read: vi.fn() };
    if (name === "DeviceDiscovery")
      return { discover: mockNative.discover, getNetworkStatus: async () => ({ online: true, supported: true }) };
    return {};
  },
}));

const SRC = path.resolve(__dirname, "../../../../src");

const CHANNELS: DeviceTrafficChannel[] = ["rest", "ftp", "telnet", "discovery", "udp"];

describe("device traffic gate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    localStorage.clear();
    saveStartupModeByUser("default");
    resetDeviceTrafficGateForTests();
    vi.mocked(addLog).mockClear();
    Object.values(mockNative.ftp).forEach((fn) => fn.mockClear());
    mockNative.telnetConnect.mockClear();
    mockNative.discover.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it("a request already queued when the mode switched is logged at info, a stray one later at warn", () => {
    saveStartupModeByUser("sid-player");
    expect(() => assertDeviceTrafficAllowed("rest", { host: "c64u" })).toThrow(SidPlayerTrafficBlockedError);
    expect(vi.mocked(addLog).mock.calls.filter(([level]) => level === "warn")).toHaveLength(0);
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "info",
      "SID Player blocked device traffic: rest",
      expect.objectContaining({ orphanedBySwitch: true }),
    );

    vi.setSystemTime(Date.now() + MODE_SWITCH_GRACE_MS + 1);
    expect(() => assertDeviceTrafficAllowed("ftp", { host: "c64u" })).toThrow(SidPlayerTrafficBlockedError);
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "SID Player blocked device traffic: ftp",
      expect.objectContaining({ orphanedBySwitch: false }),
    );
  });

  it("SPM-NET-03 blocks each channel in SID Player and logs once", () => {
    saveStartupModeByUser("sid-player");
    vi.setSystemTime(Date.now() + MODE_SWITCH_GRACE_MS + 1);
    for (const channel of CHANNELS) {
      expect(() => assertDeviceTrafficAllowed(channel, { host: "c64u" })).toThrow(SidPlayerTrafficBlockedError);
      expect(() => assertDeviceTrafficAllowed(channel, { host: "c64u" })).toThrow(
        `SID Player blocked device traffic: ${channel}`,
      );
    }
    const blocked = vi.mocked(addLog).mock.calls.filter(([level]) => level === "warn");
    expect(blocked).toHaveLength(CHANNELS.length);
    expect(blocked[0][2]).toEqual(
      expect.objectContaining({ channel: "rest", host: "c64u", stack: expect.any(String) }),
    );
  });

  it("SPM-NET-03 allows every channel in Full App", () => {
    for (const channel of CHANNELS) {
      expect(() => assertDeviceTrafficAllowed(channel)).not.toThrow();
    }
    expect(addLog).not.toHaveBeenCalled();
  });

  it("SPM-NET-03 every operation the native FTP client offers refuses in SID Player before the plugin is reached", async () => {
    saveStartupModeByUser("sid-player");
    const { FtpClient } = await import("@/lib/native/ftpClient");
    const passive = new Set(["cancelRead", "addListener"]);
    const operations = Object.keys(FtpClient).filter((name) => !passive.has(name));
    expect(operations.sort()).toEqual(
      ["listDirectory", "listDirectoryRecursive", "makeDirectory", "pingFtp", "readFile", "writeFile"].sort(),
    );
    for (const name of operations) {
      const call = (FtpClient as unknown as Record<string, (options: object) => unknown>)[name];
      await expect(Promise.resolve().then(() => call({ host: "c64u", path: "/a", data: "" }))).rejects.toThrow(
        /SID Player blocked device traffic: ftp/,
      );
    }
    for (const fn of Object.values(mockNative.ftp)) expect(fn).not.toHaveBeenCalled();
  });

  it("SPM-NET-03 the FTP plugin is registered in exactly one source file, so no entry point bypasses the funnel", () => {
    const registrations: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && /registerPlugin<[^>]*>\(\s*"FtpClient"/.test(readFileSync(full, "utf8")))
          registrations.push(path.relative(SRC, full));
      }
    };
    walk(SRC);
    expect(registrations).toEqual(["lib/native/ftpClient.ts"]);
  });

  it("SPM-NET-03 the native FTP client still reaches the plugin in Full App", async () => {
    const { FtpClient } = await import("@/lib/native/ftpClient");
    await FtpClient.listDirectory({ host: "c64u" });
    expect(mockNative.ftp.listDirectory).toHaveBeenCalledTimes(1);
  });

  it("SPM-NET-03 the Telnet client refuses to connect in SID Player", async () => {
    saveStartupModeByUser("sid-player");
    vi.stubEnv("VITE_TELNET_MOCK", "0");
    const { createTelnetClient } = await import("@/lib/telnet/telnetClient");
    const client = createTelnetClient();
    await expect(client.connect("c64u", 23)).rejects.toThrow(/SID Player blocked device traffic: telnet/);
    expect(mockNative.telnetConnect).not.toHaveBeenCalled();
  });

  it("SPM-NET-03 Telnet and FTP interactions are refused before they log an error or count a failure", async () => {
    saveStartupModeByUser("sid-player");
    const { withFtpInteraction, withTelnetInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    const { addErrorLog } = await import("@/lib/logging");
    const handler = vi.fn(async () => "ran");
    const action = { id: "a" } as never;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        withTelnetInteraction({ action, actionId: "x", intent: "user", host: "c64u", port: 23 }, handler),
      ).rejects.toBeInstanceOf(SidPlayerTrafficBlockedError);
      await expect(
        withFtpInteraction({ action, operation: "list", path: "/", intent: "user", host: "c64u" }, handler),
      ).rejects.toBeInstanceOf(SidPlayerTrafficBlockedError);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(vi.mocked(addErrorLog)).not.toHaveBeenCalled();
  });

  it("SPM-NET-03 the stream sender identity check sends no UDP in SID Player", async () => {
    saveStartupModeByUser("sid-player");
    const identify = vi.fn();
    vi.doMock("@/lib/native/streamUdp", () => ({ StreamUdp: { identify } }));
    const capacitor = await vi.importActual<typeof import("@capacitor/core")>("@capacitor/core");
    vi.doMock("@capacitor/core", () => ({
      ...capacitor,
      Capacitor: { ...capacitor.Capacitor, isPluginAvailable: () => true },
      registerPlugin: () => ({}),
    }));
    vi.resetModules();
    const { judgeStreamSender } = await import("@/lib/streams/sameDeviceSender");
    await expect(judgeStreamSender("192.168.1.9", "c64u")).resolves.toBe("unknown");
    expect(identify).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/native/streamUdp");
    vi.doUnmock("@capacitor/core");
  });

  it("SPM-NET-03 the device scan refuses to start in SID Player", async () => {
    saveStartupModeByUser("sid-player");
    const { startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");
    const result = await startDeviceDiscovery({ trigger: "manual", silent: true });
    expect(mockNative.discover).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: false });
    const warnings = vi.mocked(addLog).mock.calls.map(([level, message]) => `${level}:${message}`);
    expect(warnings).toContain("warn:SID Player blocked device traffic: discovery");
    expect(warnings).toContain("warn:Silent device discovery failed");
  });
});

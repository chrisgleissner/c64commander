/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelnetSessionApi } from "@/lib/telnet/telnetTypes";

const walk = vi.hoisted(() => ({ run: vi.fn<(session: TelnetSessionApi) => Promise<void>>() }));
const fakeSession = vi.hoisted(() => ({ current: null as null | ReturnType<typeof createFakeSession> }));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ updateConfigBatch: vi.fn() }),
  resolveDeviceHostFromStorage: () => "c64u",
}));
vi.mock("@/lib/c64api/hostConfig", () => ({ stripPortFromDeviceHost: (host: string) => host }));
vi.mock("@/lib/config/configTelnetWorkflow", () => ({
  applyRemoteConfigFromTemp: (session: TelnetSessionApi) => walk.run(session),
  saveRemoteConfigFromTemp: vi.fn(),
}));
vi.mock("@/lib/config/configWorkflow", () => ({
  createConfigWorkflow: (deps: { runApplyRemoteConfig: (fileName: string) => Promise<void> }) => ({
    applyRemoteSnapshot: () => deps.runApplyRemoteConfig("Game.cfg"),
    applyLocalSnapshot: () => deps.runApplyRemoteConfig("Game.cfg"),
  }),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));
vi.mock("@/lib/ftp/ftpClient", () => ({ listFtpDirectory: vi.fn(), readFtpFile: vi.fn(), writeFtpFile: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  withTelnetInteraction: vi.fn(async (_options: unknown, run: () => Promise<void>) => run()),
}));
vi.mock("@/lib/secureStorage", () => ({ getPassword: async () => "" }));
vi.mock("@/lib/telnet/telnetClient", () => ({ createTelnetClient: vi.fn() }));
vi.mock("@/lib/telnet/telnetConfig", () => ({ getStoredTelnetPort: () => 23 }));
vi.mock("@/lib/telnet/telnetSession", () => ({ createTelnetSession: () => fakeSession.current }));
vi.mock("@/lib/tracing/actionTrace", () => ({
  runWithImplicitAction: vi.fn(async (_id: string, run: (action: unknown) => Promise<void>) => run(null)),
}));

import { applyConfigFileReference } from "@/lib/config/applyConfigFileReference";
import {
  cancelActiveConfigApply,
  CONFIG_APPLY_UNWIND_TIMEOUT_MS,
  ConfigApplyCancelledError,
  runCancellableConfigApply,
} from "@/lib/config/configApplyCancellation";

/** A device that answers each screen read after `readDelayMs`, like the firmware's menu does. */
function createFakeSession(readDelayMs = 200) {
  let connected = false;
  const keys: string[] = [];
  return {
    keys,
    connect: vi.fn(async () => {
      connected = true;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
    }),
    isConnected: () => connected,
    sendKey: vi.fn(async (key: string) => {
      keys.push(key);
    }),
    sendRaw: vi.fn(async () => undefined),
    readScreen: vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ cells: [], menus: [], screenType: "unknown" }), readDelayMs),
        ),
    ),
  } as unknown as TelnetSessionApi & { keys: string[]; disconnect: ReturnType<typeof vi.fn> };
}

const options = {
  configRef: {
    kind: "ultimate" as const,
    fileName: "Game.cfg",
    path: "/Usb0/Game.cfg",
    modifiedAt: null,
    sizeBytes: null,
  },
  configOverrides: null,
  deviceProduct: "C64 Ultimate",
  localEntriesBySourceId: new Map(),
  localSourceTreeUris: new Map(),
};

/** The shape of the real menu walk: one key, one screen read, many times over. */
const walkDownTheBrowser = async (session: TelnetSessionApi) => {
  for (let step = 0; step < 100; step += 1) {
    await session.sendKey("DOWN");
    await session.readScreen(500);
  }
};

describe("Stop during a settings-file apply", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeSession.current = createFakeSession();
    walk.run.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends the menu walk between keystrokes, backs out of the menu and closes the session", async () => {
    walk.run.mockImplementation(walkDownTheBrowser);
    const session = fakeSession.current!;

    const apply = applyConfigFileReference(options);
    const outcome = apply.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(450);
    const keysBeforeStop = session.keys.filter((key) => key === "DOWN").length;

    void cancelActiveConfigApply();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(session.keys.filter((key) => key === "DOWN").length).toBe(keysBeforeStop);
    expect(session.keys.slice(-2)).toEqual(["ESCAPE", "LEFT"]);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(await outcome).toBeInstanceOf(ConfigApplyCancelledError);
  });

  it("lets Stop go on at once rather than waiting out the walk's screen read", async () => {
    walk.run.mockImplementation(walkDownTheBrowser);
    fakeSession.current = createFakeSession(10_000);

    const outcome = applyConfigFileReference(options).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10);
    let stopped = false;
    void cancelActiveConfigApply().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(1);

    expect(stopped).toBe(true);
    expect(await outcome).toBeInstanceOf(ConfigApplyCancelledError);
  });

  it("backs out of the menu and closes the session when the walk itself fails", async () => {
    walk.run.mockImplementation(async (session) => {
      await session.sendKey("DOWN");
      throw new Error("Load Settings not offered");
    });
    const session = fakeSession.current!;

    await expect(applyConfigFileReference(options)).rejects.toThrow("Load Settings not offered");

    expect(session.keys).toEqual(["DOWN", "ESCAPE", "LEFT"]);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
  });

  it("answers Stop at once when nothing is being applied", async () => {
    let stopped = false;
    void cancelActiveConfigApply().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(true);
  });

  // Last on purpose: the apply it starts never settles, so it stays registered as the active one.
  it("does not hold Stop longer than its bound when the apply never unwinds", async () => {
    void runCancellableConfigApply(() => new Promise<void>(() => undefined));
    let stopped = false;
    void cancelActiveConfigApply().then(() => (stopped = true));

    await vi.advanceTimersByTimeAsync(CONFIG_APPLY_UNWIND_TIMEOUT_MS - 1);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stopped).toBe(true);
  });
});

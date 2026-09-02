/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * HARD27-002. iOS reports isNativePlatform() === true but registers no StreamUdp plugin, so the
 * receiver factory used to build the native receiver there and every plugin call rejected. These
 * tests pin the two halves of that: the factory must select on plugin availability, and a
 * listener registration that rejects must not become an unhandled rejection.
 */

const native = vi.hoisted(() => ({ pluginAvailable: false }));
const logging = vi.hoisted(() => ({ addLog: vi.fn() }));

vi.mock("@/lib/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging")>()),
  addLog: logging.addLog,
}));

vi.mock("@/lib/native/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/platform")>()),
  isNativePlatform: () => true,
}));

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isPluginAvailable: () => native.pluginAvailable } };
});

const streamUdp = vi.hoisted(() => ({
  bind: vi.fn().mockResolvedValue({ localIp: "192.168.1.206", port: 11000 }),
  close: vi.fn().mockResolvedValue(undefined),
  addListener: vi.fn(),
}));

vi.mock("@/lib/native/streamUdp", () => ({ StreamUdp: streamUdp }));

import {
  createStreamReceiver,
  hasStreamTransport,
  NativeUdpStreamReceiver,
  UnsupportedStreamReceiver,
} from "@/lib/streams/streamReceiver";

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("createStreamReceiver platform gating (HARD27-002)", () => {
  beforeEach(() => {
    streamUdp.addListener.mockReset();
    streamUdp.addListener.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
    native.pluginAvailable = false;
  });

  it("degrades to the unsupported receiver when StreamUdp is not available on a native platform", () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000 });
    expect(receiver).toBeInstanceOf(UnsupportedStreamReceiver);
    expect(receiver).not.toBeInstanceOf(NativeUdpStreamReceiver);
    receiver.close();
  });

  it("reports the unsupported receiver's error state to the caller rather than throwing", () => {
    const states: string[] = [];
    const receiver = createStreamReceiver({ name: "audio", port: 11001 });
    receiver.onStateChange((state) => states.push(state));
    expect(states).toEqual(["error"]);
    expect(streamUdp.bind).not.toHaveBeenCalled();
    receiver.close();
  });

  it("reports no stream transport on a native platform without the plugin", () => {
    expect(hasStreamTransport()).toBe(false);
    native.pluginAvailable = true;
    expect(hasStreamTransport()).toBe(true);
  });

  it("builds the native receiver once the plugin is available", () => {
    native.pluginAvailable = true;
    const receiver = createStreamReceiver({ name: "video", port: 11000 });
    expect(receiver).toBeInstanceOf(NativeUdpStreamReceiver);
    receiver.close();
  });
});

describe("NativeUdpStreamReceiver listener registration failure (HARD27-002)", () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled.length = 0;
    logging.addLog.mockClear();
    native.pluginAvailable = true;
    streamUdp.addListener.mockReset();
    streamUdp.bind.mockResolvedValue({ localIp: "192.168.1.206", port: 11000 });
    process.on("unhandledRejection", record);
  });

  afterEach(() => {
    process.off("unhandledRejection", record);
  });

  /*
   * The rejection is handled at registration, not at close(). Asserting the log rather than
   * Node's unhandledRejection event is deliberate: the jsdom test environment absorbs that
   * event, so it cannot distinguish a handled registration from an unhandled one.
   */
  it("logs the registration failure at construction instead of leaving the rejection unhandled", async () => {
    streamUdp.addListener.mockRejectedValue(new Error('"StreamUdp" plugin is not implemented on ios'));
    const receiver = new NativeUdpStreamReceiver({ name: "video", port: 11000 });
    await settle();

    const registrationWarnings = logging.addLog.mock.calls.filter(
      ([level, message]) => level === "warn" && message === "Stream receiver: registering a native listener failed",
    );
    expect(registrationWarnings.length).toBeGreaterThan(0);
    expect(registrationWarnings[0]?.[2]).toMatchObject({
      name: "video",
      event: "datagram",
      error: '"StreamUdp" plugin is not implemented on ios',
    });
    expect(unhandled).toEqual([]);

    // close() must tolerate a listener that never produced a handle.
    receiver.close();
    await settle();
    expect(
      logging.addLog.mock.calls.filter(
        ([, message]) => message === "Stream receiver: removing a native listener failed",
      ),
    ).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});

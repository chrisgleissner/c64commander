/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/platform")>()),
  isNativePlatform: () => true,
}));

const streamUdp = vi.hoisted(() => {
  let datagramListener: ((event: { name: string; data: string }) => void) | null = null;
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    bind: vi.fn().mockResolvedValue({ localIp: "192.168.1.206", port: 11000 }),
    close: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn((_event: string, listener: (event: { name: string; data: string }) => void) => {
      datagramListener = listener;
      return Promise.resolve({ remove });
    }),
    remove,
    emit: (event: { name: string; data: string }) => datagramListener?.(event),
  };
});

vi.mock("@/lib/native/streamUdp", () => ({
  StreamUdp: { bind: streamUdp.bind, close: streamUdp.close, addListener: streamUdp.addListener },
}));

import { createStreamReceiver, NativeUdpStreamReceiver } from "@/lib/streams/streamReceiver";

const b64 = (...bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("NativeUdpStreamReceiver (native platform)", () => {
  beforeEach(() => {
    streamUdp.bind.mockClear();
    streamUdp.close.mockClear();
    streamUdp.remove.mockClear();
    streamUdp.bind.mockResolvedValue({ localIp: "192.168.1.206", port: 11000 });
  });

  it("is selected by createStreamReceiver on native", () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000 });
    expect(receiver).toBeInstanceOf(NativeUdpStreamReceiver);
    receiver.close();
  });

  it("binds the port, resolves its destination on ready, and forwards decoded datagrams", async () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000 });
    const states: string[] = [];
    receiver.onStateChange((s) => states.push(s));
    const datagrams: Uint8Array[] = [];
    receiver.onDatagram((d) => datagrams.push(d));

    expect(states).toEqual(["connecting"]);
    await receiver.ready?.();
    expect(streamUdp.bind).toHaveBeenCalledWith({ name: "video", port: 11000 });
    expect(receiver.destination).toBe("192.168.1.206:11000");
    expect(states).toContain("open");

    streamUdp.emit({ name: "video", data: b64(1, 2, 3) });
    expect(datagrams).toHaveLength(1);
    expect([...datagrams[0]]).toEqual([1, 2, 3]);

    // A datagram for a different stream is ignored.
    streamUdp.emit({ name: "audio", data: b64(9) });
    expect(datagrams).toHaveLength(1);

    receiver.close();
    expect(streamUdp.close).toHaveBeenCalledWith({ name: "video" });
    expect(states).toContain("closed");
  });

  it("reports an error when the native bind fails (without throwing from ready)", async () => {
    streamUdp.bind.mockRejectedValueOnce(new Error("EADDRINUSE"));
    const receiver = createStreamReceiver({ name: "audio", port: 11001 });
    const states: string[] = [];
    receiver.onStateChange((s) => states.push(s));
    await expect(receiver.ready?.()).resolves.toBeUndefined();
    expect(states).toContain("error");
    expect(receiver.destination).toBe("");
    receiver.close();
  });
});

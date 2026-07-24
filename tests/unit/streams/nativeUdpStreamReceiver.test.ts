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
  const listeners: Record<string, ((event: Record<string, unknown>) => void) | null> = {
    datagram: null,
    videoframe: null,
  };
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    bind: vi.fn().mockResolvedValue({ localIp: "192.168.1.206", port: 11000 }),
    close: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn((event: string, listener: (event: Record<string, unknown>) => void) => {
      listeners[event] = listener;
      return Promise.resolve({ remove });
    }),
    remove,
    emit: (event: { name: string; data: string }) => listeners.datagram?.(event),
    emitFrame: (event: { name: string; data: string; height: number; dropped: number; lost: number; t?: number }) =>
      listeners.videoframe?.(event),
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

  it("binds the port with native assembly off, resolves its destination, and forwards decoded datagrams", async () => {
    // Assembly OFF → the per-packet datagram path (the web/fallback behaviour).
    const receiver = createStreamReceiver({ name: "video", port: 11000, nativeVideoAssembly: false });
    const states: string[] = [];
    receiver.onStateChange((s) => states.push(s));
    const datagrams: Uint8Array[] = [];
    receiver.onDatagram((d) => datagrams.push(d));

    expect(states).toEqual(["connecting"]);
    // Destination is the multicast group (known synchronously, before bind resolves).
    expect(receiver.destination).toBe("239.0.1.64:11000");
    await receiver.ready?.();
    expect(streamUdp.bind).toHaveBeenCalledWith({ name: "video", port: 11000, group: "239.0.1.64", assemble: false });
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

  it("binds video with native assembly on and forwards assembled frames via onFrame", async () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000, nativeVideoAssembly: true });
    receiver.onStateChange(() => {});
    const frames: Array<{ bytes: number[]; height: number; t: number; dropped: number; lost: number }> = [];
    receiver.onFrame?.((frame, height, arrivalMs, dropped, lost) =>
      frames.push({ bytes: [...frame], height, t: arrivalMs, dropped, lost }),
    );
    await receiver.ready?.();
    // Assembly ON is threaded to the native bind.
    expect(streamUdp.bind).toHaveBeenCalledWith({ name: "video", port: 11000, group: "239.0.1.64", assemble: true });

    streamUdp.emitFrame({ name: "video", data: b64(7, 8, 9), height: 272, dropped: 3, lost: 1, t: 4242 });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ bytes: [7, 8, 9], height: 272, t: 4242, dropped: 3, lost: 1 });

    // A frame for a different stream name is ignored.
    streamUdp.emitFrame({ name: "audio", data: b64(1), height: 240, dropped: 0, lost: 0 });
    expect(frames).toHaveLength(1);

    receiver.close();
  });

  it("audio never requests native assembly and exposes no frame path", async () => {
    const receiver = createStreamReceiver({ name: "audio", port: 11001, nativeVideoAssembly: true });
    receiver.onStateChange(() => {});
    await receiver.ready?.();
    expect(streamUdp.bind).toHaveBeenCalledWith({ name: "audio", port: 11001, group: "239.0.1.65", assemble: false });
    receiver.close();
  });

  it("reports an error when the native bind fails (without throwing from ready)", async () => {
    streamUdp.bind.mockRejectedValueOnce(new Error("EADDRINUSE"));
    const receiver = createStreamReceiver({ name: "audio", port: 11001 });
    const states: string[] = [];
    receiver.onStateChange((s) => states.push(s));
    await expect(receiver.ready?.()).resolves.toBeUndefined();
    expect(states).toContain("error");
    expect(receiver.destination).toBe("239.0.1.65:11001"); // still known (multicast)
    receiver.close();
  });
});

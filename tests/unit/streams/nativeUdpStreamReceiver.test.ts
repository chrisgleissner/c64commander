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

// The receiver factory selects on plugin availability, not on "native" (HARD27-002) — these cases
// are the Android path, where StreamUdp is registered.
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isPluginAvailable: () => true } };
});

const streamUdp = vi.hoisted(() => {
  const listeners: Record<string, ((event: Record<string, unknown>) => void) | null> = {
    datagram: null,
    videoframe: null,
  };
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    bind: vi.fn().mockResolvedValue({ localIp: "192.168.1.206", port: 11000 }),
    close: vi.fn().mockResolvedValue(undefined),
    readStreamDiagnostics: vi.fn().mockResolvedValue({ rejectedPackets: 0 }),
    setExpectedSource: vi.fn().mockResolvedValue(undefined),
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
  StreamUdp: {
    bind: streamUdp.bind,
    close: streamUdp.close,
    addListener: streamUdp.addListener,
    readStreamDiagnostics: streamUdp.readStreamDiagnostics,
    setExpectedSource: streamUdp.setExpectedSource,
  },
}));

import { createStreamReceiver, NativeUdpStreamReceiver } from "@/lib/streams/streamReceiver";

const b64 = (...bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("NativeUdpStreamReceiver (native platform)", () => {
  beforeEach(() => {
    streamUdp.bind.mockClear();
    streamUdp.close.mockClear();
    streamUdp.remove.mockClear();
    streamUdp.readStreamDiagnostics.mockClear().mockResolvedValue({ rejectedPackets: 0 });
    streamUdp.setExpectedSource.mockClear().mockResolvedValue(undefined);
    streamUdp.bind.mockResolvedValue({ localIp: "192.168.1.206", port: 11000 });
  });

  it("is selected by createStreamReceiver on native", () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000 });
    expect(receiver).toBeInstanceOf(NativeUdpStreamReceiver);
    receiver.close();
  });

  /*
   * The mirror's groups are multicast and every Ultimate defaults to the same ones, so a second
   * machine streaming into them is received here too. Measured with two on one LAN: 20446 and 20436
   * packets into 239.0.1.64 in the same six seconds. Video is the damaging case — the two carry
   * independent frame-number spaces, so an unfiltered assembler finishes one machine's frame with
   * the other's lines. The plugin drops a foreign sender before any frame accounting, so it has to
   * be told which machine to accept.
   */
  it("tells the plugin which machine to accept packets from", async () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000, expectedSource: "192.168.1.15" });
    await receiver.ready?.();
    expect(streamUdp.bind).toHaveBeenCalledWith(expect.objectContaining({ name: "video", source: "192.168.1.15" }));
    receiver.close();
  });

  it("leaves the sender filter open when no device is selected", async () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000, expectedSource: null });
    await receiver.ready?.();
    expect(streamUdp.bind).toHaveBeenCalledWith(expect.objectContaining({ source: undefined }));
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

  /**
   * HARD25-004: ready() swallowed a bind failure and resolved anyway, so the
   * mirror controllers' try/catch never caught it and told the device to stream
   * into a socket that was never bound.
   */
  it("rejects ready() when the native bind fails, so callers do not tell the device to stream into a dead socket", async () => {
    streamUdp.bind.mockRejectedValueOnce(new Error("EADDRINUSE"));
    const receiver = createStreamReceiver({ name: "audio", port: 11001 });
    const states: string[] = [];
    receiver.onStateChange((s) => states.push(s));
    await expect(receiver.ready?.()).rejects.toThrow(/EADDRINUSE/);
    expect(states).toContain("error");
    expect(receiver.destination).toBe("239.0.1.65:11001"); // still known (multicast)
    receiver.close();
  });

  /*
   * Demo Mode: joining the real multicast group needs a live network interface, so with
   * Wi-Fi off / airplane mode StreamUdp.bind used to reject outright and Live View's mock
   * stream could never start ("Could not tell the device to start streaming video."). The
   * mock stream server sends to loopback, so the receiver must bind a plain unicast socket
   * (no multicast group) on 127.0.0.1 instead — which needs no interface at all.
   */
  it("demoLoopback binds a plain unicast socket on 127.0.0.1 instead of joining the multicast group", async () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000, demoLoopback: true });
    expect(receiver.destination).toBe("127.0.0.1:11000");
    await receiver.ready?.();
    expect(streamUdp.bind).toHaveBeenCalledWith(
      expect.objectContaining({ name: "video", port: 11000, group: undefined }),
    );
    receiver.close();
  });

  it("demoLoopback does not override an explicit destination", async () => {
    const receiver = createStreamReceiver({
      name: "audio",
      port: 11001,
      demoLoopback: true,
      destination: "127.0.0.1:9999",
    });
    expect(receiver.destination).toBe("127.0.0.1:9999");
    receiver.close();
  });

  // A filter aimed at the wrong address of a dual-homed Ultimate is silent in exactly the way a
  // stopped stream is, so the plugin's rejection counters are the only thing that separates them.
  it("reads the plugin's sender-filter counters", async () => {
    streamUdp.readStreamDiagnostics.mockResolvedValue({
      rejectedPackets: 812,
      lastRejectedSource: "192.168.1.131",
      expectedSource: "192.168.1.148",
    });
    const receiver = createStreamReceiver({ name: "video", port: 11000 });

    await expect(receiver.readDiagnostics?.()).resolves.toEqual({
      rejectedPackets: 812,
      lastRejectedSource: "192.168.1.131",
      expectedSource: "192.168.1.148",
    });
    expect(streamUdp.readStreamDiagnostics).toHaveBeenCalledWith({ name: "video" });
    receiver.close();
  });

  // A diagnosis that cannot be made must not replace the plain "stopped arriving" message with an
  // error of its own, so a plugin that will not answer resolves null rather than rejecting.
  it("answers null when the plugin cannot report its counters", async () => {
    streamUdp.readStreamDiagnostics.mockRejectedValue(new Error("not implemented"));
    const receiver = createStreamReceiver({ name: "audio", port: 11001 });

    await expect(receiver.readDiagnostics?.()).resolves.toBeNull();
    receiver.close();
  });

  it("retargets the sender filter on the socket it already bound", async () => {
    const receiver = createStreamReceiver({ name: "video", port: 11000, expectedSource: "192.168.1.148" });
    await receiver.ready?.();

    await receiver.setExpectedSource?.("192.168.1.131");

    expect(streamUdp.setExpectedSource).toHaveBeenCalledWith({ name: "video", host: "192.168.1.131" });
    // The socket is not rebound: staying in the multicast group is the point of the retarget.
    expect(streamUdp.bind).toHaveBeenCalledTimes(1);
    receiver.close();
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { AudioMirrorController, type AudioMirrorSnapshot } from "@/lib/streams/audioMirrorController";
import type { StreamReceiver, StreamConnectionState } from "@/lib/streams/streamReceiver";
import { AudioMirrorPlayer } from "@/lib/streams/audioPlayer";
import type { NativeAudioSink } from "@/lib/streams/audioNativeSink";
import {
  WebSocketStreamReceiver,
  UnsupportedStreamReceiver,
  createStreamReceiver,
  type WebSocketLike,
} from "@/lib/streams/streamReceiver";

class FakeReceiver implements StreamReceiver {
  datagram: ((data: Uint8Array, arrivalMs: number) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "10.0.0.5:11001";
  /** Set by tests exercising the Wi‑Fi audio path; undefined = no Wi‑Fi transport. */
  wifiDestination: string | undefined = undefined;
  closed = false;
  private clock = 0;
  onDatagram(handler: (data: Uint8Array, arrivalMs: number) => void) {
    this.datagram = handler;
  }
  onStateChange(handler: (s: StreamConnectionState) => void) {
    this.stateCb = handler;
  }
  close() {
    this.closed = true;
  }
  emitState(s: StreamConnectionState) {
    this.stateCb?.(s);
  }
  emit(bytes: Uint8Array, arrivalMs: number = (this.clock += 4)) {
    this.datagram?.(bytes, arrivalMs);
  }
}

const fakePlayer = (ok = true) => {
  let chunks = 0;
  return {
    start: vi.fn(async () => ok),
    playChunk: vi.fn(() => {
      chunks += 1;
    }),
    stop: vi.fn(async () => {}),
    get scheduledChunks() {
      return chunks;
    },
  } as unknown as AudioMirrorPlayer;
};

const audioPacket = (seq: number) => {
  const p = new Uint8Array(2 + 4);
  p[0] = seq & 0xff;
  p[1] = (seq >> 8) & 0xff;
  return p;
};

const fakeNativeSink = (opens = true, arrival?: { lostPackets: number }) => {
  let closed = false;
  // Option C: the sink has no JS write path — the native receive thread feeds the AudioTrack. JS only
  // opens it, polls stats for the governor, and closes it.
  const sink = {
    open: vi.fn(async () => opens),
    getStats: vi.fn(() => ({ bufferedMs: 30, underruns: 2, concealedMs: 12, arrival })),
    close: vi.fn(async () => {
      closed = true;
    }),
    get bufferCapacityMs() {
      return 40;
    },
  } as unknown as NativeAudioSink;
  return {
    sink,
    get closed() {
      return closed;
    },
  };
};

describe("AudioMirrorController", () => {
  /** Step the fake clock and the interval timers together, one watchdog check at a time. */
  const tickSeconds = async (seconds: number) => {
    for (let i = 0; i < seconds; i += 1) await vi.advanceTimersByTimeAsync(1000);
  };

  it("calls the stream lost when audio stops arriving, instead of reading live forever", async () => {
    // Cutting the phone's Wi-Fi after the mirror is live leaves the bound multicast socket open with
    // no error and no close, so the receiver reports nothing and the control keeps reading "Listening".
    vi.useFakeTimers();
    try {
      const receiver = new FakeReceiver();
      const controller = new AudioMirrorController({
        createReceiver: () => receiver,
        createPlayer: () => fakePlayer(true),
        startStream: vi.fn(async () => ({ errors: [] })),
        stopStream: vi.fn(async () => ({ errors: [] })),
        onChange: vi.fn(),
        networkBufferMs: 0,
      });
      await controller.start();
      receiver.emitState("open");
      expect(controller.getSnapshot().state).toBe("live");

      for (let second = 0; second < 6; second += 1) {
        await tickSeconds(1);
        receiver.emit(audioPacket(second));
      }
      expect(controller.getSnapshot().state).toBe("live");

      await tickSeconds(10);

      expect(controller.getSnapshot().state).toBe("error");
      expect(controller.getSnapshot().error).toMatch(/stopped arriving/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts the native socket's own packet tally, since those datagrams never reach JS", async () => {
    // On the shipping native path the plugin owns playback and stops emitting datagrams to JS, so a
    // watchdog stamped only from `onDatagram` would report every healthy native stream as lost.
    vi.useFakeTimers();
    try {
      const receiver = new FakeReceiver();
      const arrival = {
        packets: 0,
        meanGapMs: 4,
        maxGapMs: 8,
        gapsOver20ms: 0,
        gapsOver50ms: 0,
        maxClump: 1,
        lostPackets: 0,
      };
      const sink = {
        open: vi.fn(async () => true),
        getStats: vi.fn(() => ({ bufferedMs: 30, underruns: 0, concealedMs: 0, arrival })),
        close: vi.fn(async () => {}),
        get bufferCapacityMs() {
          return 40;
        },
      } as unknown as NativeAudioSink;
      const controller = new AudioMirrorController({
        createReceiver: () => receiver,
        createNativeSink: () => sink,
        startStream: vi.fn(async () => ({ errors: [] })),
        stopStream: vi.fn(async () => ({ errors: [] })),
        onChange: vi.fn(),
      });
      await controller.start();
      receiver.emitState("open");
      expect(controller.getSnapshot().state).toBe("live");

      // The plugin keeps receiving; no datagram crosses the bridge.
      for (let second = 0; second < 20; second += 1) {
        arrival.packets += 250;
        await tickSeconds(1);
      }
      expect(controller.getSnapshot().state).toBe("live");

      // The socket stops receiving: the tally stops moving.
      await tickSeconds(10);
      expect(controller.getSnapshot().state).toBe("error");
      expect(controller.getSnapshot().error).toMatch(/stopped arriving/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("connects, goes live, plays batched chunks and reports destination to the device", async () => {
    const receiver = new FakeReceiver();
    const player = fakePlayer(true);
    const startStream = vi.fn(async () => ({ errors: [] }));
    const snapshots: AudioMirrorSnapshot[] = [];
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => player,
      startStream,
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: (s) => snapshots.push(s),
      networkBufferMs: 0, // pass-through: isolate batching/chunk plumbing from jitter buffering
    });

    await controller.start();
    expect(startStream).toHaveBeenCalledWith("audio", "10.0.0.5:11001");
    receiver.emitState("open");
    expect(controller.getSnapshot().state).toBe("live");

    // 8 packets -> one batch flushed -> one chunk played
    for (let i = 0; i < 8; i += 1) receiver.emit(audioPacket(i));
    expect(player.playChunk).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().chunks).toBe(1);
  });

  it("uses the native sink (not WebAudio) when one is offered and opens; JS drives no playback", async () => {
    const receiver = new FakeReceiver();
    const native = fakeNativeSink(true);
    const player = fakePlayer(true);
    const analyzed: number[] = [];
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => player,
      createNativeSink: () => native.sink,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
      renderAudioForAnalysis: (samples) => analyzed.push(samples.length),
    });

    await controller.start();
    receiver.emitState("open");
    // The native plugin plays the audio; the WebAudio player is never created/used. Datagrams still
    // feed the A/V-sync analyzer, and JS tracks seq-gap loss for the health counter.
    for (let i = 0; i < 8; i += 1) receiver.emit(audioPacket(i));
    expect(player.start).not.toHaveBeenCalled();
    expect(player.playChunk).not.toHaveBeenCalled();
    expect(analyzed).toHaveLength(8); // analyzer still fed on the native path

    // The governor headroom signal comes from the native track, not the (absent) player.
    expect(controller.getSignals().audioBufferMs).toBe(30);
    expect(controller.getSignals().audioUnderruns).toBe(2);

    await controller.stop();
    expect(native.sink.close).toHaveBeenCalled();
  });

  it("reports the loss the NATIVE receiver measured, not the packets JS never sees", async () => {
    // The plugin stops emitting audio datagrams once it owns playback, so counting seq gaps from
    // those events yields zero on every shipping build — and "Dropped pkts" read 0 while Wi-Fi was
    // in fact losing about 3% of the audio to the video stream sharing the air. The native side
    // counts loss at the socket, which is the only place it can still be seen.
    const receiver = new FakeReceiver();
    const native = fakeNativeSink(true, { lostPackets: 137 });
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createNativeSink: () => native.sink,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    // No datagrams reach JS at all, exactly as in production.
    expect(controller.getSignals().audioLostPackets).toBe(137);
    expect(controller.getSignals().audioConcealed).toBe(12);
    await controller.stop();
  });

  it("counts native audio seq-gap loss for the health counter", async () => {
    const receiver = new FakeReceiver();
    const native = fakeNativeSink(true);
    const snapshots: AudioMirrorSnapshot[] = [];
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createNativeSink: () => native.sink,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: (s) => snapshots.push(s),
    });
    await controller.start();
    receiver.emitState("open");
    receiver.emit(audioPacket(0));
    receiver.emit(audioPacket(1));
    receiver.emit(audioPacket(4)); // gap: 2 and 3 lost
    expect(controller.getSignals().audioLostPackets).toBe(2);
    await controller.stop();
  });

  it("falls back to the WebAudio player when the native sink cannot open", async () => {
    const receiver = new FakeReceiver();
    const native = fakeNativeSink(false); // open() resolves false
    const player = fakePlayer(true);
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => player,
      createNativeSink: () => native.sink,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
      networkBufferMs: 0,
    });

    await controller.start();
    receiver.emitState("open");
    expect(player.start).toHaveBeenCalled();
    for (let i = 0; i < 8; i += 1) receiver.emit(audioPacket(i));
    expect(player.playChunk).toHaveBeenCalledTimes(1);
  });

  it("errors when audio playback is unavailable", async () => {
    const controller = new AudioMirrorController({
      createReceiver: () => new FakeReceiver(),
      createPlayer: () => fakePlayer(false),
      startStream: vi.fn(),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    expect(controller.getSnapshot().state).toBe("error");
  });

  it("stops the device stream and closes the receiver on stop", async () => {
    const receiver = new FakeReceiver();
    const player = fakePlayer(true);
    const stopStream = vi.fn(async () => ({ errors: [] }));
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => player,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream,
      onChange: vi.fn(),
    });
    await controller.start();
    await controller.stop();
    expect(stopStream).toHaveBeenCalledWith("audio");
    expect(receiver.closed).toBe(true);
    expect(player.stop).toHaveBeenCalled();
    expect(controller.getSnapshot().state).toBe("off");
  });

  it("enters error state when the device refuses to start streaming", async () => {
    const receiver = new FakeReceiver();
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => fakePlayer(true),
      startStream: vi.fn(async () => {
        throw new Error("stream busy");
      }),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    expect(controller.getSnapshot().state).toBe("error");
  });

  it("reflects a receiver error while live", async () => {
    const receiver = new FakeReceiver();
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => fakePlayer(true),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    receiver.emitState("error");
    expect(controller.getSnapshot().state).toBe("error");
  });

  it("streams over Wi‑Fi to the phone's unicast address when requested and available", async () => {
    const receiver = new FakeReceiver();
    receiver.wifiDestination = "192.168.1.185:11001";
    const startStream = vi.fn(async () => ({ errors: [] }));
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => fakePlayer(true),
      startStream,
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });

    await controller.start({ wifi: true });
    expect(startStream).toHaveBeenCalledWith("audio", "192.168.1.185:11001", { wifi: true });
    expect(controller.isOnWifi()).toBe(true);
    expect(controller.getSnapshot().route).toBe("wifi");
  });

  it("falls back to the Ethernet multicast destination when the Wi‑Fi start fails", async () => {
    const receiver = new FakeReceiver();
    receiver.wifiDestination = "192.168.1.185:11001";
    const startStream = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network Host Resolve Error")) // Wi‑Fi attempt fails
      .mockResolvedValueOnce({ errors: [] }); // Ethernet succeeds
    const stopStream = vi.fn(async () => ({ errors: [] }));
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => fakePlayer(true),
      startStream,
      stopStream,
      onChange: vi.fn(),
    });

    await controller.start({ wifi: true });
    expect(startStream).toHaveBeenNthCalledWith(1, "audio", "192.168.1.185:11001", { wifi: true });
    // The failed Wi‑Fi attempt is torn down before the Ethernet start (no two overlapping starts).
    expect(stopStream).toHaveBeenCalledWith("audio");
    expect(startStream).toHaveBeenNthCalledWith(2, "audio", "10.0.0.5:11001");
    expect(controller.isOnWifi()).toBe(false);
    expect(controller.getSnapshot().route).toBe("ethernet");
  });

  it("uses Ethernet when Wi‑Fi is requested but the transport has no Wi‑Fi address", async () => {
    const receiver = new FakeReceiver(); // wifiDestination undefined (e.g. web/docker)
    const startStream = vi.fn(async () => ({ errors: [] }));
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () => fakePlayer(true),
      startStream,
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });

    await controller.start({ wifi: true });
    expect(startStream).toHaveBeenCalledWith("audio", "10.0.0.5:11001");
    expect(controller.isOnWifi()).toBe(false);
  });
});

class MockSocket implements WebSocketLike {
  binaryType = "";
  onopen: ((e?: unknown) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
}

describe("streamReceiver", () => {
  it("WebSocketStreamReceiver forwards datagrams and connection state", () => {
    let socket: MockSocket | null = null;
    const receiver = new WebSocketStreamReceiver({
      name: "audio",
      bridgeUrl: "ws://host:8788",
      socketFactory: (url) => (socket = new MockSocket(url)),
    });
    expect(receiver.destination).toBe("239.0.1.65:11001");
    expect(socket!.url).toBe("ws://host:8788/streams/audio");

    const states: string[] = [];
    receiver.onStateChange((s) => states.push(s));
    expect(states).toEqual(["connecting"]);

    const received: Uint8Array[] = [];
    receiver.onDatagram((bytes) => received.push(bytes));
    socket!.onopen?.();
    expect(states).toContain("open");
    socket!.onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer });
    expect(Array.from(received[0])).toEqual([1, 2, 3]);
    socket!.onerror?.();
    expect(states).toContain("error");

    receiver.close();
    expect(socket!.closed).toBe(true);
  });

  it("UnsupportedStreamReceiver reports error and no-ops", () => {
    const receiver = new UnsupportedStreamReceiver();
    const states: string[] = [];
    receiver.onStateChange((s) => states.push(s));
    expect(states).toEqual(["error"]);
    expect(receiver.destination).toBe("");
    receiver.close();
  });

  it("createStreamReceiver falls back to unsupported when the socket cannot open", () => {
    const receiver = createStreamReceiver({
      name: "video",
      socketFactory: () => {
        throw new Error("no socket");
      },
    });
    expect(receiver).toBeInstanceOf(UnsupportedStreamReceiver);
  });
});

/**
 * HARD27-019. The eviction is best-effort, and when it fails the mirror keeps working — the native
 * filter drops the foreign packets — so the only symptom left is rough audio the user cannot explain.
 * The card has to name the machine that would not stop.
 */
describe("AudioMirrorController foreign-sender notice", () => {
  const sinkWithSenders = (senders: string[]) =>
    ({
      open: vi.fn(async () => true),
      getStats: vi.fn(() => ({ bufferedMs: 30, underruns: 0, concealedMs: 0, arrival: undefined })),
      close: vi.fn(async () => {}),
      get bufferCapacityMs() {
        return 40;
      },
      get senders() {
        return senders;
      },
    }) as unknown as NativeAudioSink;

  const startWithForeignSender = async (stopStreamAt: (host: string, name: "audio" | "video") => Promise<unknown>) => {
    const receiver = new FakeReceiver();
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createNativeSink: () => sinkWithSenders(["10.0.0.7", "192.168.1.15"]),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      expectedSenderHost: () => "10.0.0.7",
      stopStreamAt,
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    controller.getSignals();
    // The eviction is fire-and-forget from getSignals; let its promise chain settle.
    await Promise.resolve();
    await Promise.resolve();
    return controller;
  };

  it("names the machine that refused the stop, without touching the error field", async () => {
    const controller = await startWithForeignSender(async () => {
      throw new Error("Forbidden");
    });

    expect(controller.getSnapshot().foreignSenderNotice).toBe(
      "Another Ultimate at 192.168.1.15 is also streaming into this group; stop it on that machine.",
    );
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().state).toBe("live");
  });

  it("stays silent when the uninvited machine obeys", async () => {
    const controller = await startWithForeignSender(async () => ({ errors: [] }));
    expect(controller.getSnapshot().foreignSenderNotice).toBeNull();
  });
});

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
import {
  WebSocketStreamReceiver,
  UnsupportedStreamReceiver,
  createStreamReceiver,
  type WebSocketLike,
} from "@/lib/streams/streamReceiver";

class FakeReceiver implements StreamReceiver {
  datagram: ((data: Uint8Array) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "10.0.0.5:11001";
  closed = false;
  onDatagram(handler: (data: Uint8Array) => void) {
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
  emit(bytes: Uint8Array) {
    this.datagram?.(bytes);
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

describe("AudioMirrorController", () => {
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

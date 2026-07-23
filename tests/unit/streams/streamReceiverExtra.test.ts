/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketStreamReceiver, createStreamReceiver, type WebSocketLike } from "@/lib/streams/streamReceiver";
import { AudioMirrorPlayer } from "@/lib/streams/audioPlayer";

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

describe("streamReceiver — bridge derivation & socket factory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("derives the bridge URL from location when none is given", () => {
    let socket: MockSocket | null = null;
    const receiver = new WebSocketStreamReceiver({
      name: "video",
      socketFactory: (url) => (socket = new MockSocket(url)),
    });
    // jsdom location.host is present; ws:// (http) proto
    expect(socket!.url).toMatch(/^ws:\/\/.+\/streams\/video$/);
    expect(receiver.destination).toMatch(/:11000$/);
  });

  it("falls back to localhost when the bridge URL is unparseable", () => {
    const receiver = new WebSocketStreamReceiver({
      name: "audio",
      bridgeUrl: "::not-a-url::",
      socketFactory: (url) => new MockSocket(url),
    });
    expect(receiver.destination).toBe("localhost:11001");
  });

  it("forwards typed-array datagrams too", () => {
    let socket: MockSocket | null = null;
    const receiver = new WebSocketStreamReceiver({
      name: "audio",
      bridgeUrl: "ws://h:1",
      socketFactory: (url) => (socket = new MockSocket(url)),
    });
    const received: Uint8Array[] = [];
    receiver.onDatagram((b) => received.push(b));
    // a Uint8Array view (ArrayBuffer.isView branch)
    socket!.onmessage?.({ data: new Uint16Array([0x0201]) });
    expect(received[0][0]).toBe(0x01);
    // a raw Uint8Array
    socket!.onmessage?.({ data: new Uint8Array([9, 9]) });
    expect(Array.from(received[1])).toEqual([9, 9]);
    // an unsupported payload is ignored
    socket!.onmessage?.({ data: "nope" });
    expect(received).toHaveLength(2);
  });

  it("default socket factory throws when WebSocket is unavailable, yielding an unsupported receiver", () => {
    vi.stubGlobal("WebSocket", undefined);
    const receiver = createStreamReceiver({ name: "audio" });
    // Unsupported: destination is empty and state is error
    expect(receiver.destination).toBe("");
  });
});

describe("audioPlayer — default factory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("start() returns false when no AudioContext is available", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const player = new AudioMirrorPlayer();
    await expect(player.start()).resolves.toBe(false);
  });

  it("stop() before start() is a no-op", async () => {
    const player = new AudioMirrorPlayer();
    await expect(player.stop()).resolves.toBeUndefined();
    expect(player.scheduledChunks).toBe(0);
  });
});

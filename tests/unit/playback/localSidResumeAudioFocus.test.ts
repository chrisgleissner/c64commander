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
  getPlatform: () => "android",
}));

const requestAudioFocus = vi.hoisted(() => vi.fn().mockResolvedValue({ granted: true }));

vi.mock("@/lib/native/streamUdp", () => ({ StreamUdp: { requestAudioFocus } }));

import { LocalSidEngine } from "@/lib/playback/localSidEngine";

class FakeWorker {
  handlers: Record<string, ((event: unknown) => void)[]> = {};
  postMessage(message: unknown) {
    const msg = message as { type: string; id?: number };
    if (msg.type === "load") this.emit({ type: "ready" });
    if (msg.type === "open") this.emit({ type: "opened", id: msg.id, sampleRate: 48000, channels: 2, durationSec: 60 });
  }
  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.handlers[type] ??= []).push(handler);
  }
  removeEventListener() {}
  terminate() {}
  emit(data: unknown) {
    for (const handler of this.handlers.message ?? []) handler({ data });
  }
}

const makeEngine = () => {
  const sink = {
    currentTime: 0,
    sampleRate: 48000,
    createBuffer: (channels: number, frames: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      return { getChannelData: (c: number) => data[c]! } as unknown as AudioBuffer;
    },
    createSource: () => ({ start() {}, stop() {}, onended: null }) as never,
  };
  return new LocalSidEngine({
    workerFactory: () => new FakeWorker() as never,
    audioSinkFactory: (() => ({ sink, resume: () => {}, close: () => {} })) as never,
  });
};

describe("resuming a local tune takes audio focus back (HARD27-006)", () => {
  beforeEach(() => requestAudioFocus.mockClear());

  it("asks the native sink for focus on resume, because the pause never closed the track", async () => {
    const engine = makeEngine();
    await engine.pause();
    expect(requestAudioFocus).not.toHaveBeenCalled();

    await engine.resume();

    // Whatever interrupted the tune still held focus until this call: openAudioTrack, which is the
    // only other place that asks, does not run again for a track that stayed open.
    expect(requestAudioFocus).toHaveBeenCalledTimes(1);
  });
});

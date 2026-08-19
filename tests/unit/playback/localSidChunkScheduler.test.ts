/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  LocalSidChunkScheduler,
  type AudioScheduleBuffer,
  type AudioScheduleSink,
  type AudioScheduleSource,
} from "@/lib/playback/localSidChunkScheduler";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

/** A deterministic fake AudioContext: a manually-advanced clock + recording sinks. */
class FakeSink implements AudioScheduleSink {
  currentTime = 0;
  readonly sampleRate: number;
  readonly starts: number[] = [];
  readonly buffers: { channels: Float32Array[]; frames: number }[] = [];
  readonly liveSources: FakeSource[] = [];
  throwOnStop = false;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }

  createBuffer(channels: number, frames: number, _sampleRate: number): AudioScheduleBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    this.buffers.push({ channels: data, frames });
    return { getChannelData: (c: number) => data[c] };
  }

  createSource(_buffer: AudioScheduleBuffer): AudioScheduleSource {
    const source = new FakeSource(this);
    return source;
  }

  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

class FakeSource implements AudioScheduleSource {
  onended: (() => void) | null = null;
  stopped = false;
  constructor(private readonly sink: FakeSink) {
    this.sink.liveSources.push(this);
  }
  start(when: number): void {
    this.sink.starts.push(when);
  }
  stop(): void {
    if (this.sink.throwOnStop) throw new Error("already stopped");
    this.stopped = true;
  }
}

/** Build an interleaved Int16 chunk of `frames` per channel, ramped so we can inspect scaling. */
const makeChunk = (frames: number, channels = 2): Int16Array => {
  const pcm = new Int16Array(frames * channels);
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < channels; c += 1) {
      pcm[f * channels + c] = c === 0 ? 16384 : -32768;
    }
  }
  return pcm;
};

describe("LocalSidChunkScheduler", () => {
  it("schedules consecutive chunks back-to-back with no gap (gapless)", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink, { startPaddingSec: 0.1 });

    // 24000 frames @ 48kHz = 0.5s each.
    scheduler.schedule(makeChunk(24000), 2);
    scheduler.schedule(makeChunk(24000), 2);
    scheduler.schedule(makeChunk(24000), 2);

    // First starts after the padding; each subsequent start is exactly the
    // previous start + its 0.5s duration — no overlap, no gap.
    expect(sink.starts).toEqual([0.1, 0.6, 1.1]);
    expect(scheduler.getStats().underruns).toBe(0);
    expect(scheduler.getStats().chunksScheduled).toBe(3);
    expect(scheduler.getStats().scheduledSeconds).toBeCloseTo(1.5, 6);
  });

  it("deinterleaves Int16 → planar Float32 in [-1, 1)", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink);
    scheduler.schedule(makeChunk(4, 2), 2);

    const [{ channels }] = sink.buffers;
    // Left = 16384/32768 = 0.5; right = -32768/32768 = -1.
    expect(Array.from(channels[0])).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(Array.from(channels[1])).toEqual([-1, -1, -1, -1]);
  });

  it("counts an underrun when a chunk arrives after prior audio ran out, and resyncs", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink, { startPaddingSec: 0.1 });

    scheduler.schedule(makeChunk(24000), 2); // starts 0.1, ends 0.6
    // Let the clock run PAST the end of the scheduled audio before the next chunk.
    sink.advance(0.8); // currentTime = 0.8 > 0.6
    scheduler.schedule(makeChunk(24000), 2);

    expect(scheduler.getStats().underruns).toBe(1);
    // The late chunk resyncs to "now" (0.8), not the stale 0.6.
    expect(sink.starts[1]).toBeCloseTo(0.8, 6);
  });

  it("does not count the very first chunk as an underrun (start padding absorbs latency)", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink, { startPaddingSec: 0.15 });
    sink.advance(1.0); // clock already moved before playback starts
    scheduler.schedule(makeChunk(4800), 2); // 0.1s chunk
    expect(scheduler.getStats().underruns).toBe(0);
    expect(sink.starts[0]).toBeCloseTo(1.15, 6);
  });

  it("reports buffered-ahead seconds so the engine knows when to prefetch", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink, { startPaddingSec: 0 });
    scheduler.schedule(makeChunk(48000), 2); // 1.0s, starts at 0
    expect(scheduler.bufferedSeconds()).toBeCloseTo(1.0, 6);
    sink.advance(0.4);
    expect(scheduler.bufferedSeconds()).toBeCloseTo(0.6, 6);
    sink.advance(2.0); // clock past the end
    expect(scheduler.bufferedSeconds()).toBe(0);
  });

  it("reports playback position clamped to scheduled audio", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink, { startPaddingSec: 0.1 });
    scheduler.schedule(makeChunk(48000), 2); // starts 0.1, ends 1.1
    expect(scheduler.positionSeconds()).toBe(0); // before start
    sink.advance(0.6); // currentTime 0.6 → 0.5s into playback
    expect(scheduler.positionSeconds()).toBeCloseTo(0.5, 6);
    sink.advance(5.0); // way past the end → clamps to 1.0s scheduled
    expect(scheduler.positionSeconds()).toBeCloseTo(1.0, 6);
  });

  it("ignores empty/zero-frame chunks without starting", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink);
    scheduler.schedule(new Int16Array(0), 2);
    expect(scheduler.hasStarted()).toBe(false);
    expect(scheduler.getStats().chunksScheduled).toBe(0);
    expect(scheduler.bufferedSeconds()).toBe(0);
    expect(scheduler.positionSeconds()).toBe(0);
  });

  it("stopAll stops every still-live source and clears them", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink);
    scheduler.schedule(makeChunk(24000), 2);
    scheduler.schedule(makeChunk(24000), 2);
    scheduler.stopAll();
    expect(sink.liveSources.every((s) => s.stopped)).toBe(true);
  });

  it("stopAll swallows a source that throws on stop (already-ended teardown race)", () => {
    const sink = new FakeSink(48000);
    sink.throwOnStop = true;
    const scheduler = new LocalSidChunkScheduler(sink);
    scheduler.schedule(makeChunk(24000), 2);
    // Must not throw even though the underlying source.stop() does.
    expect(() => scheduler.stopAll()).not.toThrow();
  });

  it("stopAll logs a source that throws on stop, same as the immediate-stop path", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink);
    scheduler.schedule(makeChunk(24000), 2);
    vi.mocked(addLog).mockClear();
    sink.throwOnStop = true;
    scheduler.stopAll();
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      expect.stringContaining("stop failed"),
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  /**
   * HARD25-006: the crossfade path swallowed a stop() failure the immediate-stop
   * path right below it logged at debug - two copies of one rule had drifted apart.
   */
  it("stopAll({ keepSourcesFor }) logs a source that throws on stop, same as the immediate path", () => {
    vi.useFakeTimers();
    try {
      const sink = new FakeSink(48000);
      const scheduler = new LocalSidChunkScheduler(sink);
      scheduler.schedule(makeChunk(24000), 2);
      vi.mocked(addLog).mockClear();
      sink.throwOnStop = true;
      scheduler.stopAll({ keepSourcesFor: 50 });
      vi.advanceTimersByTime(50);
      expect(addLog).toHaveBeenCalledWith(
        "debug",
        expect.stringContaining("stop failed"),
        expect.objectContaining({ error: expect.any(String) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports mono chunks (channels = 1)", () => {
    const sink = new FakeSink(48000);
    const scheduler = new LocalSidChunkScheduler(sink, { startPaddingSec: 0 });
    const mono = new Int16Array([32767, 0, -32768, 0]); // 4 frames mono
    scheduler.schedule(mono, 1);
    expect(sink.buffers[0].frames).toBe(4);
    expect(sink.buffers[0].channels.length).toBe(1);
    expect(scheduler.getStats().scheduledSeconds).toBeCloseTo(4 / 48000, 8);
  });
});

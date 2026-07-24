/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { AudioMirrorPlayer, type MinimalAudioContext } from "@/lib/streams/audioPlayer";

/** A fake AudioContext with a caller-advanceable clock, enough for scheduling assertions. */
class FakeCtx implements MinimalAudioContext {
  currentTime = 0;
  readonly destination = {} as AudioNode;
  createBuffer(_channels: number, length: number): AudioBuffer {
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    return { getChannelData: (c: number) => (c === 0 ? left : right) } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode {
    return { buffer: null, connect() {}, start() {} } as unknown as AudioBufferSourceNode;
  }
  async resume() {}
  async close() {}
}

const chunk = (frames: number): Int16Array => new Int16Array(frames * 2);

describe("AudioMirrorPlayer — governor signals", () => {
  it("reports buffer depth ahead of the audio clock (ms)", async () => {
    const ctx = new FakeCtx();
    const player = new AudioMirrorPlayer(() => ctx, 0.08, 48000);
    await player.start();
    expect(player.bufferedMs).toBe(0); // nothing scheduled yet

    player.playChunk(chunk(4800)); // 100 ms of audio, scheduled at currentTime + 80 ms lead-in
    // nextTime = 0.08 + 0.1 = 0.18 s ahead of currentTime 0 → 180 ms buffered.
    expect(player.bufferedMs).toBeCloseTo(180, 0);

    ctx.currentTime = 0.1; // 100 ms of playback elapses
    expect(player.bufferedMs).toBeCloseTo(80, 0);
  });

  it("counts an underrun when the previous chunk has fully drained before the next is scheduled", async () => {
    const ctx = new FakeCtx();
    const player = new AudioMirrorPlayer(() => ctx, 0.08, 48000);
    await player.start();

    player.playChunk(chunk(4800)); // schedules to ~0.18 s
    expect(player.underrunCount).toBe(0);

    // Jump the audio clock PAST the end of the scheduled audio: the output ran dry.
    ctx.currentTime = 0.5;
    player.playChunk(chunk(4800));
    expect(player.underrunCount).toBe(1);

    // A healthy follow-up (clock still within scheduled audio) does not add an underrun.
    player.playChunk(chunk(4800));
    expect(player.underrunCount).toBe(1);
  });

  it("resets signals on stop", async () => {
    const ctx = new FakeCtx();
    const player = new AudioMirrorPlayer(() => ctx, 0.08, 48000);
    await player.start();
    ctx.currentTime = 0;
    player.playChunk(chunk(4800));
    ctx.currentTime = 0.5;
    player.playChunk(chunk(4800));
    expect(player.underrunCount).toBe(1);
    await player.stop();
    expect(player.underrunCount).toBe(0);
    expect(player.bufferedMs).toBe(0);
  });
});

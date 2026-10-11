/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => [] as Array<{ level: string; message: string }>);
vi.mock("@/lib/logging", () => ({
  addLog: (level: string, message: string) => logs.push({ level, message }),
}));

import { webAudioSinkFactory } from "@/lib/playback/localSidAudioSink";
import { LocalSidUnavailableError } from "@/lib/playback/sidRenderer/rendererFactory";

/** An AudioParam that records its automation, and can be told to refuse it as a busy context does. */
class FakeParam {
  value = 1;
  events: Array<[string, number, number]> = [];
  refuse = false;
  private record(kind: string, value: number, at: number) {
    if (this.refuse) throw new Error("automation refused");
    this.events.push([kind, value, at]);
  }
  cancelScheduledValues(at: number) {
    this.record("cancel", 0, at);
  }
  setValueAtTime(value: number, at: number) {
    this.record("set", value, at);
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.record("ramp", value, at);
  }
}

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 2;
  readonly master = new FakeParam();
  readonly connected: unknown[] = [];
  readonly calls: string[] = [];
  constructor(readonly options: { sampleRate: number }) {
    FakeContext.last = this;
  }
  get sampleRate() {
    return this.options.sampleRate;
  }
  readonly destination = {};
  createGain() {
    return { gain: this.master, connect: (to: unknown) => this.connected.push(to) };
  }
  createBuffer(channels: number, frames: number, rate: number) {
    return { channels, frames, rate };
  }
  createBufferSource() {
    return { buffer: null as unknown, connect: (to: unknown) => this.connected.push(to) };
  }
  resume() {
    this.calls.push("resume");
    return Promise.resolve();
  }
  suspend() {
    this.calls.push("suspend");
    return Promise.resolve();
  }
  close() {
    this.calls.push("close");
    return Promise.resolve();
  }
}

describe("the Web Audio sink", () => {
  const original = (globalThis as { AudioContext?: unknown }).AudioContext;
  beforeEach(() => {
    logs.length = 0;
    (globalThis as { AudioContext?: unknown }).AudioContext = FakeContext;
  });
  afterEach(() => {
    (globalThis as { AudioContext?: unknown }).AudioContext = original;
  });

  it("plays every buffer through one master gain at the requested rate", () => {
    const audio = webAudioSinkFactory(44100);
    const context = FakeContext.last!;
    expect(audio.sink.sampleRate).toBe(44100);
    expect(audio.sink.currentTime).toBe(2);
    expect(audio.sink.createBuffer(2, 10, 44100)).toEqual({ channels: 2, frames: 10, rate: 44100 });
    audio.sink.createSource({} as AudioBuffer);
    expect(context.connected).toEqual([context.destination, expect.objectContaining({ gain: context.master })]);
    void audio.resume();
    void audio.suspend?.();
    audio.close();
    expect(context.calls).toEqual(["resume", "suspend", "close"]);
  });

  it("ramps a level change over 20 ms rather than stepping it, and clamps it", () => {
    const audio = webAudioSinkFactory(48000);
    const { master } = FakeContext.last!;
    audio.setGain!(1.7);
    expect(master.events).toEqual([
      ["cancel", 0, 2],
      ["set", 1, 2],
      ["ramp", 1, 2.02],
    ]);
  });

  it("fades out to near silence and in to the listener's level over the time asked for", () => {
    const audio = webAudioSinkFactory(48000);
    const { master } = FakeContext.last!;
    audio.fadeOut!(500);
    audio.fadeIn!(250, 0.5);
    expect(master.events).toEqual([
      ["cancel", 0, 2],
      ["set", 1, 2],
      ["ramp", 0.0001, 2.5],
      ["cancel", 0, 2],
      ["set", 0.0001, 2],
      ["ramp", 0.5, 2.25],
    ]);
  });

  it("sets the level directly, and says so, when the context refuses a ramp", () => {
    const audio = webAudioSinkFactory(48000);
    const { master } = FakeContext.last!;
    master.refuse = true;
    audio.setGain!(0.3);
    expect(master.value).toBe(0.3);
    audio.fadeIn!(100, 0.6);
    expect(master.value).toBe(0.6);
    audio.fadeOut!(100);
    expect(master.value).toBe(0);
    expect(logs.map((entry) => entry.level)).toEqual(["debug", "debug", "debug"]);
    expect(logs[0].message).toMatch(/could not be scheduled/);
  });

  it("is unavailable where there is no AudioContext", () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    expect(() => webAudioSinkFactory(48000)).toThrow(LocalSidUnavailableError);
  });
});

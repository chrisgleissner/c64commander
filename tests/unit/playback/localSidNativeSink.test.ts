/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => [] as { level: string; message: string }[]);
vi.mock("@/lib/logging", () => ({
  addLog: (level: string, message: string) => logs.push({ level, message }),
  addErrorLog: (message: string) => logs.push({ level: "error", message }),
}));

import { claimNativeTrack, isSuperseded, nextSerial } from "@/lib/audio/nativeTrackOwnership";
import { createNativeLocalSidSink, type NativeLocalAudioBackend } from "@/lib/playback/localSidNativeSink";
import type { SidAudioSessionStats } from "@/lib/native/sidAudio";
import type { NativePcmRef } from "@/lib/playback/sidRenderer/pcmPayload";
import { PCM_HEADER_BYTES, PCM_HEADER_SAMPLES } from "@/lib/playback/sidRenderer/nativePcmPort";

/**
 * The JS half of on-device playback on Android is a controller: it numbers chunks, hands them to
 * the native feed (as a native buffer reference, a binary message, or base64), keeps the clock from
 * the playhead the feed reports and announces chunk completions. What the feed does to the samples
 * — backpressure, the crossfade, the silence detector — is tested where it lives, in
 * `LocalAudioFeedTest.kt`.
 */

const RATE = 48000;

interface Call {
  method: string;
  options: Record<string, unknown>;
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const makeBackend = (overrides: { port?: boolean; stats?: () => Partial<SidAudioSessionStats> } = {}) => {
  const calls: Call[] = [];
  const portMessages: ArrayBuffer[] = [];
  const record =
    (method: string, result: unknown = undefined) =>
    (options: Record<string, unknown> = {}) => {
      calls.push({ method, options });
      return Promise.resolve(result);
    };
  let statsFor: () => Partial<SidAudioSessionStats> = overrides.stats ?? (() => ({}));
  const feed = {
    describe: record("describe", { binaryPortProbes: 0 }),
    openSession: record("openSession"),
    enqueueBuffer: record("enqueueBuffer", {}),
    enqueuePcm: record("enqueuePcm"),
    flush: record("flush"),
    pause: record("pause"),
    resume: record("resume"),
    setGain: record("setGain"),
    fade: record("fade"),
    fadeIn: record("fadeIn"),
    resetSilence: record("resetSilence"),
    beginTransition: record("beginTransition"),
    takeTail: record("takeTail"),
    adoptTail: record("adoptTail"),
    release: record("release"),
    close: record("close"),
    stats: (options: Record<string, unknown>) => {
      calls.push({ method: "stats", options });
      return Promise.resolve({ known: true, ...statsFor() } as SidAudioSessionStats);
    },
  };
  const trackOwner = {};
  const backend: NativeLocalAudioBackend = {
    feed: feed as unknown as NativeLocalAudioBackend["feed"],
    trackOwner,
    binaryPort: () =>
      Promise.resolve(overrides.port ? { postMessage: (m: ArrayBuffer) => portMessages.push(m) } : null),
    attach: () => {
      calls.push({ method: "attach", options: {} });
      return Promise.resolve();
    },
  };
  return {
    backend,
    calls,
    portMessages,
    trackOwner,
    of: (method: string) => calls.filter((c) => c.method === method).map((c) => c.options),
    setStats: (next: () => Partial<SidAudioSessionStats>) => {
      statsFor = next;
    },
  };
};

const stereo = (frames: number, value: number) => new Int16Array(frames * 2).fill(value);

const ref = (bufferId: number, startFrame: number, frames: number): NativePcmRef => ({
  kind: "native-pcm",
  bufferId,
  startFrame,
  frames,
});

describe("the native sink controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logs.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const build = (backendOverrides?: Parameters<typeof makeBackend>[0]) => {
    const backend = makeBackend(backendOverrides);
    const audio = createNativeLocalSidSink(RATE, backend.backend, "sidplayez")!;
    return { ...backend, audio, sink: audio.sink };
  };

  it("attaches, then opens one session with a ring measured in seconds and a short prime", async () => {
    const { calls, of } = build();
    await flush();
    expect(calls[0].method).toBe("attach");
    const [open] = of("openSession");
    expect(open.bufferMs).toBe(15000);
    expect(open.maxRingMs).toBe(20000);
    expect(open.trackBursts).toBe(16);
    expect(open.primeMs as number).toBeLessThan(5000);
    expect(open.sampleRate).toBe(RATE);
  });

  it("lets go of its debug seam when it closes, but not of a newer sink's", () => {
    const seam = globalThis as { __localSinkDebug?: () => unknown };
    const first = build();
    const second = build();
    first.audio.close();
    expect(seam.__localSinkDebug).toBeTypeOf("function");
    second.audio.close();
    expect(seam.__localSinkDebug).toBeUndefined();
  });

  it("is unavailable without a backend, so the engine falls back to Web Audio", () => {
    expect(createNativeLocalSidSink(RATE, null)).toBeNull();
  });

  it("hands a native chunk over as a buffer reference, never as samples", async () => {
    const { sink, of } = build();
    sink.createPcmSource!(ref(7, 100, 2400), 2).start(0);
    await flush();
    expect(of("enqueueBuffer")).toEqual([
      { serial: expect.any(Number), seq: 1, bufferId: 7, startFrame: 100, frames: 2400 },
    ]);
    expect(of("enqueuePcm")).toHaveLength(0);
  });

  it("sends JS PCM over the binary port with its header, writing the header in place when there is room", async () => {
    const { sink, portMessages, of } = build({ port: true });
    await flush();
    const withRoom = new Int16Array(PCM_HEADER_SAMPLES + 8).fill(5).subarray(PCM_HEADER_SAMPLES);
    sink.createPcmSource!(withRoom, 2).start(0);
    sink.createPcmSource!(stereo(4, 9), 2).start(0.1);
    await flush();
    expect(portMessages).toHaveLength(2);
    expect(portMessages[0]).toBe(withRoom.buffer);
    const header = new DataView(portMessages[1], 0, PCM_HEADER_BYTES);
    expect(header.getUint32(0, true)).toBe(0x50343643);
    expect(header.getUint32(4, true)).toBe(1);
    expect(header.getUint32(12, true)).toBe(2);
    expect(header.getUint32(16, true)).toBe(4);
    expect(Array.from(new Int16Array(portMessages[1], PCM_HEADER_BYTES))).toEqual(Array(8).fill(9));
    expect(of("enqueuePcm")).toHaveLength(0);
  });

  it("falls back to base64 over the bridge when the port is not confirmed, with the same samples", async () => {
    const { sink, of } = build();
    await flush();
    sink.createPcmSource!(Int16Array.from([1, -1, 300, -300]), 2).start(0);
    await flush();
    const [sent] = of("enqueuePcm");
    const bytes = Uint8Array.from(atob(sent.data as string), (c) => c.charCodeAt(0));
    expect(Array.from(new Int16Array(bytes.buffer))).toEqual([1, -1, 300, -300]);
  });

  it("duplicates a mono chunk to stereo rather than letting it play at double speed", async () => {
    const { sink, of } = build();
    await flush();
    sink.createPcmSource!(Int16Array.from([7, 8]), 1).start(0);
    await flush();
    const bytes = Uint8Array.from(atob(of("enqueuePcm")[0].data as string), (c) => c.charCodeAt(0));
    expect(Array.from(new Int16Array(bytes.buffer))).toEqual([7, 7, 8, 8]);
  });

  it("numbers chunks and commands in one sequence, and flushes at the next number, restarting the clock", async () => {
    const { sink, audio, of } = build();
    sink.createPcmSource!(ref(1, 0, RATE), 2).start(0);
    sink.createPcmSource!(ref(2, 0, RATE), 2).start(1);
    await flush();
    audio.flush!();
    await flush();
    expect(of("enqueueBuffer").map((o) => o.seq)).toEqual([1, 2]);
    expect(of("flush")).toEqual([{ serial: expect.any(Number), seq: 3 }]);
    expect(sink.currentTime).toBe(0);
    sink.createPcmSource!(ref(3, 0, RATE), 2).start(0);
    await flush();
    sink.fadeIn!(100, 1);
    sink.releaseForHandover!();
    await flush();
    expect(of("enqueueBuffer").map((o) => o.seq)).toEqual([1, 2, 4]);
    expect(of("fadeIn").map((o) => o.seq)).toEqual([5]);
    expect(of("release").map((o) => o.seq)).toEqual([6]);
  });

  it("keeps the clock on the playhead the feed reports, and never past what it handed over", async () => {
    const { sink, setStats } = build();
    sink.createPcmSource!(ref(1, 0, RATE), 2).start(0);
    setStats(() => ({ playedFrames: RATE / 2, bufferedMs: 400, active: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(sink.currentTime).toBeGreaterThanOrEqual(0.5);
    await vi.advanceTimersByTimeAsync(200);
    expect(sink.currentTime).toBeLessThanOrEqual(1);
    setStats(() => ({ playedFrames: RATE * 4, bufferedMs: 0, active: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(sink.currentTime).toBe(1);
  });

  it("does not run the clock ahead while the feed reports nothing playing", async () => {
    const { sink, setStats } = build();
    sink.createPcmSource!(ref(1, 0, RATE * 4), 2).start(0);
    setStats(() => ({ playedFrames: 0, bufferedMs: 0, active: false }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sink.currentTime).toBe(0);
  });

  it("announces a chunk as played only once the playhead has passed it", async () => {
    const { sink, setStats } = build();
    const ended = vi.fn();
    const source = sink.createPcmSource!(ref(1, 0, RATE / 2), 2);
    source.onended = ended;
    source.start(0);
    setStats(() => ({ playedFrames: RATE / 4, bufferedMs: 0, active: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(ended).not.toHaveBeenCalled();
    setStats(() => ({ playedFrames: RATE / 2, bufferedMs: 0, active: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("drops a source that was stopped before it started", async () => {
    const { sink, of } = build();
    const source = sink.createPcmSource!(ref(1, 0, 100), 2);
    source.stop();
    source.start(0);
    await flush();
    expect(of("enqueueBuffer")).toHaveLength(0);
  });

  it("holds the clock still while paused and continues from the same place", async () => {
    const { sink, audio, setStats, of } = build();
    sink.createPcmSource!(ref(1, 0, RATE * 2), 2).start(0);
    setStats(() => ({ playedFrames: RATE / 2, bufferedMs: 1000, active: true }));
    await vi.advanceTimersByTimeAsync(300);
    await audio.suspend!();
    const held = sink.currentTime;
    await vi.advanceTimersByTimeAsync(2000);
    expect(sink.currentTime).toBe(held);
    await audio.resume!();
    await flush();
    expect(of("pause")).toHaveLength(1);
    expect(of("resume")).toHaveLength(1);
  });

  it("routes the listener's level to the track, clamped so it can only attenuate", async () => {
    const { audio, of } = build();
    audio.setGain!(1.7);
    audio.setGain!(-1);
    audio.setGain!(0.4);
    await flush();
    expect(of("setGain").map((o) => o.gain)).toEqual([1, 0, 0.4]);
  });

  it("opens a tune at the listener's level and fades the blend up from silence", async () => {
    const { audio, of } = build();
    audio.fadeIn!(1500, 0.6);
    await flush();
    expect(of("setGain")).toEqual([{ gain: 0.6 }]);
    expect(of("fadeIn")).toEqual([{ serial: expect.any(Number), seq: expect.any(Number), ms: 1500 }]);
  });

  it("passes a crossfade tail from one session to the next by id, in the order the engine asks", async () => {
    const outgoing = build();
    const incoming = createNativeLocalSidSink(RATE, outgoing.backend, "sidplayez")!;
    outgoing.audio.beginCrossfadeTailPlayout!(4.6);
    const tail = outgoing.audio.takeCrossfadeTail!(4.6);
    outgoing.audio.releaseForHandover!();
    incoming.adoptCrossfadeTail!(tail, 0.6);
    await flush();
    const sequence = outgoing.calls
      .filter((c) => ["beginTransition", "takeTail", "release", "adoptTail"].includes(c.method))
      .map((c) => c.method);
    expect(sequence).toEqual(["beginTransition", "takeTail", "release", "adoptTail"]);
    expect(outgoing.of("adoptTail")[0].tailId).toBe(outgoing.of("takeTail")[0].tailId);
    expect(outgoing.of("adoptTail")[0].serial).not.toBe(outgoing.of("takeTail")[0].serial);
  });

  it("announces the completions that went with a track the feed had to re-open", async () => {
    const { sink, setStats } = build();
    const ended = vi.fn();
    const source = sink.createPcmSource!(ref(1, 0, RATE * 10), 2);
    source.onended = ended;
    source.start(0);
    setStats(() => ({ playedFrames: 0, bufferedMs: 0, active: true, reopens: 1 }));
    await vi.advanceTimersByTimeAsync(300);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("reports a silent fault from the feed, and forgets it on a reset", async () => {
    const { sink, audio, setStats, of } = build();
    sink.createPcmSource!(ref(1, 0, RATE), 2).start(0);
    setStats(() => ({ silentFault: true, silentSeconds: 13 }));
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.isSilentFault!()).toBe(true);
    audio.resetSilence!();
    expect(audio.isSilentFault!()).toBe(false);
    await flush();
    expect(of("resetSilence")).toHaveLength(1);
  });

  it("never walks the underrun count backwards", async () => {
    const { sink, audio, setStats } = build();
    sink.createPcmSource!(ref(1, 0, RATE), 2).start(0);
    setStats(() => ({ underruns: 3 }));
    await vi.advanceTimersByTimeAsync(300);
    setStats(() => ({ underruns: 1 }));
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.audioUnderruns!()).toBe(3);
  });

  it("claims the shared track with its first chunk, not when it is built", async () => {
    const backend = makeBackend();
    const mirror = {};
    const mirrorSerial = nextSerial();
    claimNativeTrack(backend.trackOwner, mirror, mirrorSerial);
    const audio = createNativeLocalSidSink(RATE, backend.backend)!;
    await flush();
    expect(isSuperseded(backend.trackOwner, mirrorSerial)).toBe(false);
    audio.sink.createPcmSource!(ref(1, 0, 10), 2).start(0);
    await flush();
    expect(isSuperseded(backend.trackOwner, mirrorSerial)).toBe(true);
  });

  it("leaves the shared track's ownership alone when a newer sink has claimed it", async () => {
    const backend = makeBackend();
    const audio = createNativeLocalSidSink(RATE, backend.backend)!;
    audio.sink.createPcmSource!(ref(1, 0, 10), 2).start(0);
    await flush();
    const newer = {};
    const newerSerial = nextSerial();
    claimNativeTrack(backend.trackOwner, newer, newerSerial);
    audio.close();
    expect(isSuperseded(backend.trackOwner, newerSerial - 1)).toBe(true);
  });

  it("tells the feed to close, and to release without closing for a handover", async () => {
    const a = build();
    a.audio.close();
    const b = build();
    b.audio.releaseForHandover!();
    await flush();
    expect(a.of("close")).toHaveLength(1);
    expect(b.of("release")).toHaveLength(1);
    expect(b.of("close")).toHaveLength(0);
  });

  it("logs a feed that refuses a call instead of throwing into the engine", async () => {
    const backend = makeBackend();
    (backend.backend.feed as unknown as { enqueueBuffer: () => Promise<never> }).enqueueBuffer = () =>
      Promise.reject(new Error("bridge closed"));
    const audio = createNativeLocalSidSink(RATE, backend.backend)!;
    audio.sink.createPcmSource!(ref(1, 0, 10), 2).start(0);
    await flush();
    expect(logs.some((l) => l.level === "warn" && l.message.includes("handing a chunk"))).toBe(true);
  });

  it("does not take float buffers, which are for Web Audio", () => {
    const { sink } = build();
    expect(() => sink.createBuffer(2, 10, RATE)).toThrow(/S16/);
  });
});

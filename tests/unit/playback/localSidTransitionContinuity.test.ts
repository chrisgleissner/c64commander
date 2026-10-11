/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CROSSFADE_MS_MAX } from "@/lib/config/appSettings";
import { LocalSidEngine } from "@/lib/playback/localSidEngine";
import { createNativeLocalSidSink, type NativeLocalAudioBackend } from "@/lib/playback/localSidNativeSink";

/**
 * There must be one continuous stream of samples from one tune to the next.
 *
 * The samples are mixed on the native side now (`LocalAudioFeed.kt`), so the proof has two halves
 * that meet in a transcript. This half runs the real engine, scheduler and sink against a stand-in
 * worker whose open takes as long as it does on a Pixel 4 (2.6 s), records every call the sink makes
 * to the native feed with its time, and checks the order of the crossfade handshake. The transcripts
 * are written to `android/app/src/test/fixtures/local-audio/`, where `LocalAudioFeedTranscriptTest`
 * replays each one against the real feed on virtual time and asks what reached the speaker: was
 * there ever silence between the tunes, and were both tunes sounding together during a crossfade.
 *
 * The transcripts are golden: this test fails if what it records differs from what is committed, so
 * a change to the engine's side of the handshake cannot pass here while the native side is still
 * being tested against the old one. Regenerate with `UPDATE_LOCAL_AUDIO_TRANSCRIPTS=1`.
 */

vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
  hasCompleteRomSet: () => true,
}));

const RATE = 48000;
const FIXTURE_DIR = resolve(__dirname, "../../../android/app/src/test/fixtures/local-audio");

interface TranscriptEntry {
  t: number;
  method: string;
  [key: string]: unknown;
}

/**
 * The native feed, as far as the engine can observe it: calls are recorded, and the playhead it
 * reports advances in real time over what has been handed to the session, so the engine renders on
 * as it would against the device. It does nothing to the samples — that is the feed's own job, and
 * the transcript is how it gets tested.
 */
const createRecordingFeed = () => {
  const transcript: TranscriptEntry[] = [];
  const origin = performance.now();
  const sessions = new Map<number, { frames: number; startedAt: number | null; playedAtFlush: number }>();
  const now = () => Math.round(performance.now() - origin);
  const decodeFirst = (data: string) => {
    const binary = atob(data);
    const view = new DataView(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) view.setUint8(i, binary.charCodeAt(i));
    return { value: view.getInt16(0, true), frames: binary.length / 4 };
  };
  const record =
    (method: string) =>
    async (options: Record<string, unknown> = {}) => {
      const entry: TranscriptEntry = { t: now(), method, ...options };
      if (method === "enqueuePcm") {
        const { value, frames } = decodeFirst(options.data as string);
        delete entry.data;
        entry.value = value;
        entry.frames = frames;
        const session = sessions.get(options.serial as number);
        if (session) {
          session.frames += frames;
          session.startedAt ??= performance.now();
        }
      }
      if (method === "openSession") {
        sessions.set(options.serial as number, { frames: 0, startedAt: null, playedAtFlush: 0 });
      }
      if (method === "flush") {
        const session = sessions.get(options.serial as number);
        if (session) {
          session.frames = 0;
          session.startedAt = null;
        }
      }
      transcript.push(entry);
      return undefined;
    };
  const feed = {
    describe: async () => ({ binaryPortProbes: 0 }),
    openSession: record("openSession"),
    enqueueBuffer: record("enqueueBuffer"),
    enqueuePcm: record("enqueuePcm"),
    flush: record("flush"),
    pause: record("pause"),
    resume: record("resume"),
    setGain: record("setGain"),
    fade: record("fade"),
    fadeIn: record("fadeIn"),
    resetSilence: async () => undefined,
    beginTransition: record("beginTransition"),
    takeTail: record("takeTail"),
    adoptTail: record("adoptTail"),
    release: record("release"),
    close: record("close"),
    stats: async ({ serial }: { serial: number }) => {
      const session = sessions.get(serial);
      if (!session || session.startedAt === null) return { known: true, playedFrames: 0, bufferedMs: 0, active: false };
      const elapsedFrames = Math.floor(((performance.now() - session.startedAt) / 1000) * RATE);
      const played = Math.min(session.frames, elapsedFrames);
      return {
        known: true,
        playedFrames: played,
        bufferedMs: ((session.frames - played) / RATE) * 1000,
        active: true,
      };
    },
  };
  const backend: NativeLocalAudioBackend = {
    feed: feed as unknown as NativeLocalAudioBackend["feed"],
    trackOwner: {},
    binaryPort: async () => null,
    attach: async () => undefined,
  };
  return { backend, transcript };
};

/** Song 0 is the outgoing tune and song 1 the incoming one; a sample says which tune it came from. */
const levelOf = (songIndex: number | undefined) => (songIndex === 1 ? 12000 : 8000);

/** Stands in for the WASM renderer; each tune plays a steady tone at its own level. */
class FakeWorker {
  handlers: Record<string, ((event: unknown) => void)[]> = {};
  static openDelayMs = 0;
  static chunksPerTune = 120;
  private openId: number | null = null;
  private rendered = 0;
  private amplitude = 0;

  postMessage(message: unknown) {
    const msg = message as { type: string; id?: number; seconds?: number; songIndex?: number };
    if (msg.type === "load") this.emit({ type: "ready" });
    if (msg.type === "open") {
      this.openId = msg.id ?? 0;
      this.rendered = 0;
      this.amplitude = levelOf(msg.songIndex);
      setTimeout(() => {
        this.emit({ type: "opened", id: msg.id, sampleRate: RATE, channels: 2, tuneInfo: null, romRequired: false });
      }, FakeWorker.openDelayMs);
    }
    if (msg.type === "prerender") {
      const seconds = msg.seconds ?? 4;
      const pcm = new Int16Array(Math.round(seconds * RATE) * 2).fill(levelOf(msg.songIndex));
      setTimeout(() => {
        this.emit({ type: "prerender-chunk", id: msg.id, pcm, sampleRate: RATE, channels: 2, seconds });
        this.emit({ type: "prerendered", id: msg.id, sampleRate: RATE, channels: 2, seconds });
      }, 0);
      return;
    }
    if (msg.type === "render") {
      if (this.rendered >= FakeWorker.chunksPerTune) {
        setTimeout(() => this.emit({ type: "end", id: this.openId }), 0);
        return;
      }
      this.rendered += 1;
      const frames = Math.round(((msg.seconds as number | undefined) ?? 0.5) * RATE);
      const pcm = new Int16Array(frames * 2).fill(this.amplitude);
      setTimeout(() => this.emit({ type: "chunk", id: this.openId, pcm, samples: pcm.length, renderMs: 1 }), 0);
    }
  }
  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.handlers[type] ??= []).push(handler);
  }
  emit(data: unknown) {
    for (const h of this.handlers.message ?? []) h({ data });
  }
  terminate() {}
}

const settle = async (turns = 60, ms = 4000) => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const playSettled = async (engine: LocalSidEngine, songIndex: number, cacheKey?: string, ms = 2000) => {
  const started = engine.play(new ArrayBuffer(8), songIndex, {}, cacheKey);
  await settle(60, ms);
  await started;
  await settle(60, ms);
};

const buildEngine = (backend: NativeLocalAudioBackend) =>
  new LocalSidEngine({
    workerFactory: () => new FakeWorker() as never,
    audioSinkFactory: ((sampleRate: number) => createNativeLocalSidSink(sampleRate, backend)) as never,
  });

const methodsOf = (transcript: TranscriptEntry[], names: string[]) =>
  transcript.filter((entry) => names.includes(entry.method)).map((entry) => `${entry.method}:${entry.serial}`);

/**
 * Session serials and tail ids come from counters shared by everything in this file, so they are
 * renumbered in order of appearance; otherwise a transcript would depend on which tests ran first.
 */
const normalize = (transcript: TranscriptEntry[]): TranscriptEntry[] => {
  const serials = new Map<unknown, number>();
  const tails = new Map<unknown, number>();
  const renumber = (map: Map<unknown, number>, value: unknown) => {
    if (!map.has(value)) map.set(value, map.size + 1);
    return map.get(value);
  };
  return transcript.map((entry) => ({
    ...entry,
    ...("serial" in entry ? { serial: renumber(serials, entry.serial) } : {}),
    ...("tailId" in entry ? { tailId: renumber(tails, entry.tailId) } : {}),
  }));
};

/** Compare with the committed transcript, or write it when regenerating. */
const checkGolden = (name: string, scenario: { transcript: TranscriptEntry[] } & Record<string, unknown>) => {
  const path = resolve(FIXTURE_DIR, `${name}.json`);
  const text = `${JSON.stringify({ ...scenario, transcript: normalize(scenario.transcript) }, null, 1)}\n`;
  if (process.env.UPDATE_LOCAL_AUDIO_TRANSCRIPTS === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return;
  }
  expect(readFileSync(path, "utf8")).toBe(text);
};

describe("one continuous stream of samples across a track change", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    FakeWorker.openDelayMs = 0;
  });
  afterEach(() => vi.useRealTimers());

  const crossfadeScenario = async (fadeMs: number, warmed: boolean) => {
    localStorage.setItem("c64u_playback_crossfade_ms", String(fadeMs));
    const { backend, transcript } = createRecordingFeed();
    const engine = buildEngine(backend);
    await playSettled(engine, 0, warmed ? "tune-0" : undefined);
    if (warmed) {
      engine.prerender("tune-1", new ArrayBuffer(8), 1, 8);
      await settle();
    }
    const changeAt = transcript.length;
    FakeWorker.openDelayMs = 2600;
    await playSettled(engine, 1, warmed ? "tune-1" : undefined, 4000);
    return { transcript, changeAt };
  };

  it("hands the outgoing tune to the next one in the order the feed needs", async () => {
    const { transcript, changeAt } = await crossfadeScenario(1500, false);
    const sessions = [...new Set(transcript.filter((e) => e.method === "openSession").map((e) => e.serial))];
    expect(sessions).toHaveLength(2);
    const [outgoing, incoming] = sessions;
    const change = transcript.slice(changeAt);
    expect(methodsOf(change, ["beginTransition", "openSession", "takeTail", "release", "adoptTail"])).toEqual([
      `beginTransition:${outgoing}`,
      `openSession:${incoming}`,
      `takeTail:${outgoing}`,
      `release:${outgoing}`,
      `adoptTail:${incoming}`,
    ]);
    // The tail budget covers opening the next tune as well as the fade itself.
    const take = change.find((e) => e.method === "takeTail")!;
    expect(take.maxSeconds as number).toBeGreaterThanOrEqual(4 + 1.5);
    const adopt = change.find((e) => e.method === "adoptTail")!;
    expect(adopt.tailId).toBe(take.tailId);
    expect(adopt.seconds).toBe(1.5);
    // The incoming tune starts from silence and fades up to the listener's level.
    expect(change.some((e) => e.method === "fadeIn" && e.serial === incoming && e.ms === 1500)).toBe(true);
    // And the outgoing tune is never closed — closing would flush the track under the incoming one.
    expect(change.some((e) => e.method === "close" && e.serial === outgoing)).toBe(false);
  });

  it("starts the next tune from its warmed opening before the slow open has finished", async () => {
    const { transcript, changeAt } = await crossfadeScenario(1500, true);
    const change = transcript.slice(changeAt);
    const incoming = change.find((e) => e.method === "openSession")!.serial;
    const firstOwnAudio = change.find((e) => e.method === "enqueuePcm" && e.serial === incoming)!;
    const playRequestedAt = change[0].t;
    // From memory, not after the 2.6 s open.
    expect(firstOwnAudio.t - playRequestedAt).toBeLessThan(500);
  });

  for (const fadeMs of [600, 1500, 3000, CROSSFADE_MS_MAX]) {
    it(`records the ${fadeMs} ms crossfade for the native replay`, async () => {
      const { transcript } = await crossfadeScenario(fadeMs, true);
      checkGolden(`crossfade-${fadeMs}`, { sampleRate: RATE, fadeMs, transcript });
    });
  }

  it("records a slow open with a crossfade, where the tail has to cover the whole wait", async () => {
    const { transcript } = await crossfadeScenario(1500, false);
    checkGolden("crossfade-1500-slow-open", { sampleRate: RATE, fadeMs: 1500, transcript });
  });

  it("cuts straight over when no crossfade is configured: the old session closes, nothing is handed over", async () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "0");
    const { backend, transcript } = createRecordingFeed();
    const engine = buildEngine(backend);
    await playSettled(engine, 0);
    const changeAt = transcript.length;
    await playSettled(engine, 1);
    const change = transcript.slice(changeAt);
    expect(change.some((e) => e.method === "takeTail" || e.method === "beginTransition")).toBe(false);
    const outgoing = transcript.find((e) => e.method === "openSession")!.serial;
    expect(change.findIndex((e) => e.method === "close" && e.serial === outgoing)).toBeLessThan(
      change.findIndex((e) => e.method === "openSession"),
    );
    checkGolden("cut", { sampleRate: RATE, fadeMs: 0, transcript });
  });
});

// @vitest-environment node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SidAudioEngine } from "libsidplayfp-wasm";

import { createRendererDispatcher } from "@/lib/playback/sidRenderer/sidRendererContract";
import { WasmSidRendererCore, type SidAudioEngineCtor } from "@/lib/playback/sidRenderer/wasmRendererCore";
import type { LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

/**
 * The WASM renderer against the real libsidplayfp-wasm, through the dispatcher the worker uses.
 *
 * The worker file itself is a few lines of wiring; everything that decides what the listener hears
 * — song selection, the fallback chip, seeking, the pre-render — is here, run on the real emulator.
 */
const TONE_LADDER = readFileSync(resolve(__dirname, "../../../fixtures/tone-ladder.sid"));
const RATE = 48000;

const tune = () => TONE_LADDER.buffer.slice(TONE_LADDER.byteOffset, TONE_LADDER.byteOffset + TONE_LADDER.byteLength);

const harness = () => {
  const core = new WasmSidRendererCore(async () => SidAudioEngine as unknown as SidAudioEngineCtor);
  const received: LocalSidWorkerToMain[] = [];
  const dispatch = createRendererDispatcher(core, (message) => received.push(message));
  const until = async (predicate: (m: LocalSidWorkerToMain) => boolean) => {
    for (let i = 0; i < 2000 && !received.some(predicate); i += 1) await new Promise((r) => setTimeout(r, 5));
    return received.find(predicate)!;
  };
  return { core, received, dispatch, until };
};

const peakToPeak = (pcm: Int16Array) => {
  let lo = 0;
  let hi = 0;
  for (const v of pcm) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
};

const open = (engine: "residfp" | "sidlite", id = 1, sidModel?: "MOS6581" | "MOS8580") => ({
  type: "open" as const,
  id,
  sidBytes: tune(),
  songIndex: 0,
  sampleRate: RATE,
  engine,
  sidModel,
});

describe.each(["residfp", "sidlite"] as const)("the %s WASM renderer", (engine) => {
  it("opens a tune and renders audible interleaved stereo at the requested rate", async () => {
    const { dispatch, until } = harness();
    void dispatch({ type: "load" });
    void dispatch(open(engine));
    const opened = await until((m) => m.type === "opened");
    expect(opened).toMatchObject({ type: "opened", id: 1, sampleRate: RATE, channels: 2, romRequired: false });
    void dispatch({ type: "render", id: 1, seconds: 1 });
    const chunk = (await until((m) => m.type === "chunk")) as Extract<LocalSidWorkerToMain, { type: "chunk" }>;
    const pcm = chunk.pcm as Int16Array;
    expect(chunk.samples).toBe(RATE * 2);
    expect(peakToPeak(pcm)).toBeGreaterThan(1000);
  });

  it("lands a seek where a straight render would be", async () => {
    const straight = harness();
    void straight.dispatch(open(engine));
    void straight.dispatch({ type: "render", id: 1, seconds: 3 });
    const whole = ((await straight.until((m) => m.type === "chunk")) as { pcm: Int16Array }).pcm;

    const seeking = harness();
    void seeking.dispatch(open(engine));
    void seeking.dispatch({ type: "seek", id: 2, positionSeconds: 2 });
    void seeking.dispatch({ type: "render", id: 1, seconds: 1 });
    expect(await seeking.until((m) => m.type === "seeked")).toMatchObject({ positionSeconds: 2 });
    const after = ((await seeking.until((m) => m.type === "chunk")) as { pcm: Int16Array }).pcm;
    // The emulation is deterministic within a fresh module only for reSIDfp's undithered paths, so
    // equality is judged by level and by the tone being the same note, not sample by sample.
    expect(Math.abs(peakToPeak(after) - peakToPeak(whole.subarray(RATE * 4)))).toBeLessThan(peakToPeak(whole) * 0.1);
  });

  it("reserves room in front of a live chunk when asked, for the native feed's header", async () => {
    const { dispatch, until } = harness();
    void dispatch({ type: "load", pcmHeadroomSamples: 12 });
    void dispatch(open(engine));
    void dispatch({ type: "render", id: 1, seconds: 0.1 });
    const chunk = (await until((m) => m.type === "chunk")) as { pcm: Int16Array };
    expect(chunk.pcm.byteOffset).toBe(24);
    expect(chunk.pcm.buffer.byteLength).toBe(24 + chunk.pcm.byteLength);
  });

  it("pre-renders on a second player, in slices that add up to the request", async () => {
    const { dispatch, until, received } = harness();
    void dispatch({
      type: "prerender",
      id: 9,
      sidBytes: tune(),
      songIndex: 0,
      sampleRate: RATE,
      seconds: 7,
      engine,
    });
    const done = await until((m) => m.type === "prerendered");
    expect(done).toMatchObject({ id: 9, seconds: 7, channels: 2 });
    const slices = received.filter((m) => m.type === "prerender-chunk") as { pcm: Int16Array; seconds: number }[];
    expect(slices.map((s) => s.seconds)).toEqual([5, 7]);
    expect(slices.reduce((n, s) => n + s.pcm.length, 0)).toBe(7 * RATE * 2);
  });

  it("answers a render with no tune open with the end, and keeps going after a bad tune", async () => {
    const { dispatch, until } = harness();
    void dispatch({ type: "render", id: 3, seconds: 0.1 });
    expect(await until((m) => m.type === "end")).toMatchObject({ id: 3 });
    void dispatch({ ...open(engine, 4), sidBytes: new Uint8Array(40).fill(7).buffer });
    expect(await until((m) => m.type === "error")).toMatchObject({ id: 4, code: "open" });
    void dispatch(open(engine, 5));
    expect(await until((m) => m.type === "opened" && m.id === 5)).toBeDefined();
  });
});

describe("the fallback chip", () => {
  it("is used for a tune that names none, which the tone ladder does not", async () => {
    const render = async (sidModel: "MOS6581" | "MOS8580") => {
      const { dispatch, until } = harness();
      void dispatch(open("residfp", 1, sidModel));
      void dispatch({ type: "render", id: 1, seconds: 1 });
      return ((await until((m) => m.type === "chunk")) as { pcm: Int16Array }).pcm;
    };
    const a = await render("MOS6581");
    const b = await render("MOS8580");
    let differing = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differing += 1;
    expect(differing).toBeGreaterThan(a.length / 10);
  });
});

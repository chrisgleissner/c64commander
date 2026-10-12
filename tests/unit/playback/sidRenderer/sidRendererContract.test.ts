/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  createRendererDispatcher,
  type SidRendererCore,
  type SidRendererOpenRequest,
} from "@/lib/playback/sidRenderer/sidRendererContract";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import type { NativePcmRef } from "@/lib/playback/sidRenderer/pcmPayload";

/**
 * The rules every renderer gets from the shared dispatcher, checked against a scripted core whose
 * calls can be held open: one call at a time, in order; renders and seeks for a replaced tune are
 * skipped (a skipped seek is still answered); a running pre-render can see that a newer one is
 * waiting; and failures become typed error messages.
 */

interface Deferred {
  resolve: () => void;
}

const scriptedCore = () => {
  const calls: string[] = [];
  let active = 0;
  let maxActive = 0;
  const holds: Deferred[] = [];
  const hold = () =>
    new Promise<void>((resolve) => {
      holds.push({ resolve });
    });
  let holdNext = false;
  const enter = async (name: string) => {
    calls.push(name);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (holdNext) {
      holdNext = false;
      await hold();
    }
  };
  const leave = () => {
    active -= 1;
  };
  const core: SidRendererCore & { failOpen?: boolean } = {
    async load() {
      await enter("load");
      leave();
    },
    async open(request: SidRendererOpenRequest) {
      await enter(`open:${request.songIndex}`);
      leave();
      if (core.failOpen) throw new Error("not a tune");
      return { sampleRate: request.sampleRate, channels: 2, tuneInfo: null };
    },
    async render(seconds: number) {
      await enter(`render:${seconds}`);
      leave();
      const pcm: NativePcmRef = { kind: "native-pcm", bufferId: 1, startFrame: 0, frames: 10 };
      return { pcm, samples: 20, renderMs: 1 };
    },
    async seek(position: number) {
      await enter(`seek:${position}`);
      leave();
      return position;
    },
    async prerender(request, onSlice, isSuperseded) {
      await enter(`prerender:${request.seconds}`);
      let seconds = 0;
      while (seconds < request.seconds && !isSuperseded()) {
        seconds += 1;
        onSlice({ pcm: new Int16Array(4), sampleRate: 48000, channels: 2, seconds });
        await Promise.resolve();
        await Promise.resolve();
      }
      leave();
      return { sampleRate: 48000, channels: 2, seconds };
    },
    async close() {
      await enter("close");
      leave();
    },
    dispose() {
      calls.push("dispose");
    },
  };
  return {
    core,
    calls,
    maxActive: () => maxActive,
    holdNext: () => {
      holdNext = true;
    },
    release: () => holds.shift()?.resolve(),
  };
};

const openMessage = (id: number, songIndex: number): LocalSidMainToWorker => ({
  type: "open",
  id,
  sidBytes: new ArrayBuffer(4),
  songIndex,
  sampleRate: 48000,
  engine: "sidplayez",
});

const settle = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

describe("the shared renderer dispatcher", () => {
  it("never runs two calls on one core at once, and keeps their order", async () => {
    const { core, calls, maxActive } = scriptedCore();
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    void dispatch({ type: "load" });
    void dispatch(openMessage(1, 0));
    void dispatch({ type: "render", id: 1, seconds: 0.5 });
    void dispatch({ type: "render", id: 1, seconds: 0.25 });
    void dispatch({ type: "seek", id: 2, positionSeconds: 3 });
    await settle();
    expect(calls).toEqual(["load", "open:0", "render:0.5", "render:0.25", "seek:3"]);
    expect(maxActive()).toBe(1);
    expect(out.map((m) => m.type)).toEqual(["ready", "opened", "chunk", "chunk", "seeked"]);
  });

  it("skips renders and seeks queued for a tune that has since been replaced, still answering the seek", async () => {
    const { core, calls, holdNext, release } = scriptedCore();
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    holdNext();
    void dispatch(openMessage(1, 0));
    void dispatch({ type: "render", id: 1, seconds: 0.5 });
    void dispatch({ type: "seek", id: 7, positionSeconds: 60 });
    void dispatch(openMessage(2, 1));
    void dispatch({ type: "render", id: 2, seconds: 0.5 });
    await settle();
    release();
    await settle();
    expect(calls).toEqual(["open:0", "open:1", "render:0.5"]);
    expect(out.find((m) => m.type === "seeked")).toEqual({ type: "seeked", id: 7, positionSeconds: 60 });
    expect(out.filter((m) => m.type === "chunk").map((m) => (m as { id: number }).id)).toEqual([2]);
  });

  it("answers a render that produces nothing with the end of the tune", async () => {
    const { core } = scriptedCore();
    core.render = async () => null;
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    void dispatch({ type: "render", id: 4, seconds: 0.5 });
    await settle();
    expect(out).toEqual([{ type: "end", id: 4 }]);
  });

  it("turns a failed open into a typed error for that request, and carries on", async () => {
    const { core } = scriptedCore();
    core.failOpen = true;
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    void dispatch(openMessage(3, 0));
    await settle();
    core.failOpen = false;
    void dispatch(openMessage(4, 0));
    await settle();
    expect(out[0]).toEqual({ type: "error", code: "open", id: 3, message: "not a tune" });
    expect(out[1]).toMatchObject({ type: "opened", id: 4 });
  });

  it("reports a failed render and a failed load under their own codes", async () => {
    const { core } = scriptedCore();
    core.render = async () => {
      throw new Error("jammed");
    };
    core.load = async () => {
      throw new Error("no module");
    };
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    void dispatch({ type: "load" });
    void dispatch({ type: "render", id: 5, seconds: 1 });
    await settle();
    expect(out).toEqual([
      { type: "error", code: "load", message: "no module" },
      { type: "error", code: "render", id: 5, message: "jammed" },
    ]);
  });

  it("streams a pre-render's slices with progress, then says it is complete", async () => {
    const { core } = scriptedCore();
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    void dispatch({
      type: "prerender",
      id: 8,
      sidBytes: new ArrayBuffer(4),
      songIndex: 0,
      sampleRate: 48000,
      seconds: 2,
      engine: "residfp",
    });
    await settle();
    expect(out.map((m) => m.type)).toEqual([
      "prerender-chunk",
      "prerender-progress",
      "prerender-chunk",
      "prerender-progress",
      "prerendered",
    ]);
    expect(out[3]).toEqual({ type: "prerender-progress", id: 8, fraction: 1 });
  });

  it("lets a running pre-render see that a newer one is waiting, so it stops instead of finishing", async () => {
    const { core } = scriptedCore();
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    void dispatch({
      type: "prerender",
      id: 1,
      sidBytes: new ArrayBuffer(4),
      songIndex: 0,
      sampleRate: 48000,
      seconds: 1000,
      engine: "residfp",
    });
    await Promise.resolve();
    void dispatch({
      type: "prerender",
      id: 2,
      sidBytes: new ArrayBuffer(4),
      songIndex: 0,
      sampleRate: 48000,
      seconds: 2,
      engine: "residfp",
    });
    await settle();
    const first = out.find((m) => m.type === "prerendered" && m.id === 1) as { seconds: number };
    expect(first.seconds).toBeLessThan(1000);
    expect(out.find((m) => m.type === "prerendered" && m.id === 2)).toMatchObject({ seconds: 2 });
  });

  it("reports a failed pre-render as a pre-render error, which the engine keeps apart from playback", async () => {
    const { core } = scriptedCore();
    core.prerender = async () => {
      throw new Error("out of memory");
    };
    const out: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(core, (m) => out.push(m));
    void dispatch({
      type: "prerender",
      id: 6,
      sidBytes: new ArrayBuffer(4),
      songIndex: 0,
      sampleRate: 48000,
      seconds: 2,
      engine: "residfp",
    });
    await settle();
    expect(out).toEqual([{ type: "error", code: "prerender", id: 6, message: "out of memory" }]);
  });
});

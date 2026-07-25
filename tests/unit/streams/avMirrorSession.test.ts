/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The controllers (D/E) have their own tests; here we mock them so the shared-session
 * logic (snapshot broadcast, frame broadcast + replay, live derivation, toggle routing,
 * stopAll) is tested in isolation. Each fake controller captures the deps the session
 * hands it, so the test can drive onChange / renderFrame exactly as a real stream would.
 */

interface Captured {
  deps: {
    onChange: (s: {
      state: string;
      droppedPackets?: number;
      fps?: number;
      standard?: string;
      error: string | null;
    }) => void;
    renderFrame?: (frame: Uint8Array, height: number, arrivalMs?: number) => void;
    renderAudio?: (samples: Int16Array) => void;
    renderAudioForAnalysis?: (samples: Int16Array, arrivalMs: number) => void;
  };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  isOnWifi?: ReturnType<typeof vi.fn>;
}

// Hoisted so the arrays exist before the module's `avMirrorSession` singleton
// constructs its controllers at import time.
const { audioInstances, videoInstances } = vi.hoisted(() => ({
  audioInstances: [] as Captured[],
  videoInstances: [] as Captured[],
}));

vi.mock("@/lib/streams/audioMirrorController", () => ({
  AudioMirrorController: class {
    deps: Captured["deps"];
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    isOnWifi = vi.fn(() => false);
    constructor(deps: Captured["deps"]) {
      this.deps = deps;
      audioInstances.push(this as unknown as Captured);
    }
  },
}));

vi.mock("@/lib/streams/videoMirrorController", () => ({
  VideoMirrorController: class {
    deps: Captured["deps"];
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    constructor(deps: Captured["deps"]) {
      this.deps = deps;
      videoInstances.push(this as unknown as Captured);
    }
  },
}));

import { AvMirrorSession, WIFI_AUDIO_BLOCKS_VIDEO, avMirrorSession } from "@/lib/streams/avMirrorSession";

const makeSession = () => {
  audioInstances.length = 0;
  videoInstances.length = 0;
  const startStream = vi.fn(async () => ({}));
  const stopStream = vi.fn(async () => ({}));
  const session = new AvMirrorSession({ startStream, stopStream });
  return { session, audio: audioInstances[0], video: videoInstances[0], startStream, stopStream };
};

describe("AvMirrorSession", () => {
  beforeEach(() => {
    audioInstances.length = 0;
    videoInstances.length = 0;
  });

  it("starts with an all-off snapshot and replays it to a new subscriber", () => {
    const { session } = makeSession();
    const seen: unknown[] = [];
    const unsubscribe = session.subscribe((snap) => seen.push(snap));
    expect(seen).toHaveLength(1);
    expect(session.getSnapshot()).toEqual({
      audio: { state: "off", droppedPackets: 0, error: null },
      video: { state: "off", fps: 0, droppedPackets: 0, framesLost: 0, standard: "PAL", error: null },
    });
    expect(session.audioLive).toBe(false);
    expect(session.videoLive).toBe(false);
    unsubscribe();
  });

  it("broadcasts controller onChange to subscribers and derives live state", () => {
    const { session, audio, video } = makeSession();
    const seen: string[] = [];
    session.subscribe((snap) => seen.push(`${snap.audio.state}/${snap.video.state}`));

    audio.deps.onChange({ state: "connecting", droppedPackets: 0, error: null });
    expect(session.audioLive).toBe(true); // connecting counts as live
    audio.deps.onChange({ state: "live", droppedPackets: 4, error: null });
    expect(session.getSnapshot().audio).toEqual({ state: "live", droppedPackets: 4, error: null });
    expect(session.audioLive).toBe(true);

    video.deps.onChange({ state: "live", fps: 42, error: null });
    expect(session.videoLive).toBe(true);
    expect(session.getSnapshot().video).toEqual({ state: "live", fps: 42, error: null });

    // off again
    audio.deps.onChange({ state: "off", droppedPackets: 0, error: null });
    expect(session.audioLive).toBe(false);
    expect(seen).toContain("live/off");
    expect(seen).toContain("live/live");
  });

  it("stops notifying an unsubscribed listener", () => {
    const { session, audio } = makeSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    listener.mockClear();
    unsubscribe();
    audio.deps.onChange({ state: "live", droppedPackets: 0, error: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it("broadcasts video frames and replays the latest to a late subscriber", () => {
    const { session, video } = makeSession();
    const frames: Array<{ len: number; height: number }> = [];
    session.subscribeFrames((frame, height) => frames.push({ len: frame.length, height }));

    video.deps.renderFrame?.(new Uint8Array([1, 2, 3]), 272);
    expect(frames).toEqual([{ len: 3, height: 272 }]);

    // a late subscriber immediately receives the last frame
    const late: number[] = [];
    session.subscribeFrames((frame) => late.push(frame.length));
    expect(late).toEqual([3]);
  });

  it("broadcasts per-packet analyzer audio (with arrival timestamp) to audio subscribers", () => {
    const { session, audio } = makeSession();
    const batches: Array<{ len: number; arrivalMs: number }> = [];
    const unsubscribe = session.subscribeAudio((samples, arrivalMs) =>
      batches.push({ len: samples.length, arrivalMs }),
    );
    audio.deps.renderAudioForAnalysis?.(new Int16Array([1, 2, 3, 4]), 100);
    expect(batches).toEqual([{ len: 4, arrivalMs: 100 }]);
    unsubscribe();
    audio.deps.renderAudioForAnalysis?.(new Int16Array([5, 6]), 200);
    expect(batches).toEqual([{ len: 4, arrivalMs: 100 }]); // no delivery after unsubscribe
  });

  it("stops delivering frames after unsubscribe", () => {
    const { session, video } = makeSession();
    const handler = vi.fn();
    const unsubscribe = session.subscribeFrames(handler);
    unsubscribe();
    video.deps.renderFrame?.(new Uint8Array([1]), 272);
    expect(handler).not.toHaveBeenCalled();
  });

  it("clears the retained frame on stopVideo so a new subscriber gets no stale replay", async () => {
    const { session, video } = makeSession();
    video.deps.renderFrame?.(new Uint8Array([9, 9]), 240);
    await session.stopVideo();
    const late = vi.fn();
    session.subscribeFrames(late);
    expect(late).not.toHaveBeenCalled();
    expect(video.stop).toHaveBeenCalled();
  });

  it("routes toggleAudio to start when off and stop when live", async () => {
    const { session, audio } = makeSession();
    await session.toggleAudio();
    expect(audio.start).toHaveBeenCalledTimes(1);
    expect(audio.stop).not.toHaveBeenCalled();

    audio.deps.onChange({ state: "live", droppedPackets: 0, error: null });
    await session.toggleAudio();
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it("routes toggleVideo to start when off and stop when live", async () => {
    const { session, video } = makeSession();
    await session.toggleVideo();
    expect(video.start).toHaveBeenCalledTimes(1);

    video.deps.onChange({ state: "live", fps: 10, error: null });
    await session.toggleVideo();
    expect(video.stop).toHaveBeenCalledTimes(1);
  });

  it("stopAll stops both streams even if one rejects", async () => {
    const { session, audio, video } = makeSession();
    audio.stop.mockRejectedValueOnce(new Error("boom"));
    await expect(session.stopAll()).resolves.toBeUndefined();
    expect(audio.stop).toHaveBeenCalled();
    expect(video.stop).toHaveBeenCalled();
  });

  it("exposes a shared app-wide singleton", () => {
    expect(avMirrorSession).toBeInstanceOf(AvMirrorSession);
  });

  describe("Wi‑Fi audio route (firmware wifi=true)", () => {
    beforeEach(() => {
      localStorage.clear(); // default policy = dynamic
      // The Wi‑Fi route is a developer-mode-only capability (firmware PR #732 is
      // not in released firmware yet); enable dev mode so the route decisions apply.
      localStorage.setItem("c64u_dev_mode_enabled", "1");
    });

    it("requests Wi‑Fi for audio-only under the default (dynamic) policy", async () => {
      const { session, audio } = makeSession();
      await session.startAudio();
      expect(audio.start).toHaveBeenCalledWith({ wifi: true });
    });

    it("forces Ethernet regardless of the persisted policy when developer mode is off", async () => {
      localStorage.setItem("c64u_dev_mode_enabled", "0"); // dev mode off
      localStorage.setItem("c64u_stream_audio_route", "wifi"); // even an explicit Wi‑Fi policy
      const { session, audio } = makeSession();
      await session.startAudio();
      expect(audio.start).toHaveBeenCalledWith({ wifi: false });
    });

    it("does not request Wi‑Fi for audio while video is already live", async () => {
      const { session, audio, video } = makeSession();
      video.deps.onChange({ state: "live", fps: 10, error: null });
      await session.startAudio();
      expect(audio.start).toHaveBeenCalledWith({ wifi: false });
    });

    it("never requests Wi‑Fi under the ethernet policy", async () => {
      localStorage.setItem("c64u_stream_audio_route", "ethernet");
      const { session, audio } = makeSession();
      await session.startAudio();
      expect(audio.start).toHaveBeenCalledWith({ wifi: false });
    });

    it("moves Wi‑Fi audio to Ethernet before starting video (dynamic), then back on stop", async () => {
      const { session, audio, video } = makeSession();
      audio.isOnWifi!.mockReturnValue(true); // audio currently on Wi‑Fi
      await session.startVideo();
      // Audio was restarted on Ethernet, then video started.
      expect(audio.stop).toHaveBeenCalled();
      expect(audio.start).toHaveBeenCalledWith({ wifi: false });
      expect(video.start).toHaveBeenCalled();

      // Now video stops → audio returns to Wi‑Fi (dynamic).
      audio.deps.onChange({ state: "live", droppedPackets: 0, error: null }); // audio still live
      audio.start.mockClear();
      await session.stopVideo();
      expect(audio.start).toHaveBeenCalledWith({ wifi: true });
    });

    it("blocks video under the wifi policy while Wi‑Fi audio is live, with an explanatory message", async () => {
      localStorage.setItem("c64u_stream_audio_route", "wifi");
      const { session, audio, video } = makeSession();
      audio.isOnWifi!.mockReturnValue(true);
      await session.startVideo();
      expect(video.start).not.toHaveBeenCalled();
      expect(session.getSnapshot().video.error).toBe(WIFI_AUDIO_BLOCKS_VIDEO);
    });
  });

  describe("operation serialization (serialize())", () => {
    /** Drain all pending microtasks (a macrotask boundary flushes the microtask queue). */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("does not let a concurrent stop interleave with an in-flight start", async () => {
      // Regression for the serialize() op-chain: a route conversion's stop+start (or any
      // audio toggle) must run to completion before the next op begins, so late continuations
      // can't issue transport commands out of order. Without serialize() the stop below would
      // fire immediately, while the start is still awaiting — this test would then fail.
      const { session, audio } = makeSession();
      const order: string[] = [];
      let releaseStart!: () => void;
      const startGate = new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
      audio.start.mockImplementation(async () => {
        order.push("start:begin");
        await startGate; // hold the start open so a non-serialized stop could slip in
        order.push("start:end");
      });
      audio.stop.mockImplementation(async () => {
        order.push("stop:begin");
        order.push("stop:end");
      });

      const p1 = session.startAudio();
      const p2 = session.stopAudio();

      await flush();
      // The start is in flight (blocked on the gate); the stop MUST still be queued behind it.
      expect(order).toEqual(["start:begin"]);
      expect(audio.stop).not.toHaveBeenCalled();

      releaseStart();
      await Promise.all([p1, p2]);
      // stop ran strictly after start fully completed — never interleaved.
      expect(order).toEqual(["start:begin", "start:end", "stop:begin", "stop:end"]);
    });
  });
});

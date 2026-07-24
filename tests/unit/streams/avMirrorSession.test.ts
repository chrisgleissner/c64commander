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

import { AvMirrorSession, avMirrorSession } from "@/lib/streams/avMirrorSession";

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
});

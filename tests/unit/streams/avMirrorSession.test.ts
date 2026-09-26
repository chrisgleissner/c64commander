/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The controllers (D/E) have their own tests; here we mock them so the shared-session
 * logic (snapshot broadcast, frame broadcast + replay, live derivation, toggle routing,
 * stopAll) is tested in isolation. Each fake controller captures the deps the session
 * hands it, so the test can drive onChange / renderFrame exactly as a real stream would.
 */

interface Captured {
  adoptSender?: ReturnType<typeof vi.fn>;
  getSignals?: ReturnType<typeof vi.fn>;
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
    schedulePresent?: (present: () => void) => void;
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
    // Present on the real controller, so the session reads it rather than falling back to zeros.
    getSignals = vi.fn(() => ({
      audioBufferMs: 0,
      audioUnderruns: 0,
      audioConcealed: 0,
      audioLostPackets: 0,
      audioRejectedPackets: 0,
    }));
    adoptSender = vi.fn(async () => {});
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
    adoptSender = vi.fn(async () => {});
    constructor(deps: Captured["deps"]) {
      this.deps = deps;
      videoInstances.push(this as unknown as Captured);
    }
  },
}));

const { createStreamReceiverMock } = vi.hoisted(() => ({
  createStreamReceiverMock: vi.fn((options: object) => options),
}));
vi.mock("@/lib/streams/streamReceiver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/streams/streamReceiver")>()),
  createStreamReceiver: createStreamReceiverMock,
}));

import { AvMirrorSession, avMirrorSession } from "@/lib/streams/avMirrorSession";
import { __resetPhoneAudioOwnership, claimPhoneAudio, interruptPhoneAudio } from "@/lib/audio/phoneAudioOwnership";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logging")>();
  return { ...actual, addLog: vi.fn() };
});

const makeSession = () => {
  createStreamReceiverMock.mockClear();
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

  /**
   * `VideoMirrorController`'s drop-late queue only drops anything if presentation is DEFERRED: a
   * synchronous scheduler consumes `pending` before the next frame can supersede it, so the queue
   * degenerates to "present every frame inline" and `backlogReplacements` is structurally 0.
   * The controller's own tests inject a deferring pump, so they passed while production wired no
   * scheduler at all — the coalescing was dead in the app and only in the app. On a Pixel 4 that
   * showed up as a 2.5 s JS stall being followed by a 174 fps burst from a 50 Hz source, as every
   * bridge-buffered frame was decoded and painted in turn.
   */
  it("hands the video mirror a deferring present scheduler, so the drop-late queue can coalesce", async () => {
    const { video } = makeSession();
    expect(typeof video.deps.schedulePresent).toBe("function");

    let presented = false;
    video.deps.schedulePresent!(() => {
      presented = true;
    });
    expect(presented).toBe(false); // must not present inline — that is what defeats the queue

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(presented).toBe(true); // but the frame must still reach the canvas
  });

  it("starts with an all-off snapshot and replays it to a new subscriber", () => {
    const { session } = makeSession();
    const seen: unknown[] = [];
    const unsubscribe = session.subscribe((snap) => seen.push(snap));
    expect(seen).toHaveLength(1);
    expect(session.getSnapshot()).toEqual({
      audio: { state: "off", droppedPackets: 0, error: null, foreignSenderNotice: null, senderMismatch: null },
      video: {
        state: "off",
        fps: 0,
        droppedPackets: 0,
        framesLost: 0,
        standard: "PAL",
        error: null,
        senderMismatch: null,
      },
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

  describe("audio and video streams start independently", () => {
    afterEach(() => {
      localStorage.removeItem("c64u_dev_mode_enabled");
      localStorage.removeItem("c64u_stream_audio_route");
    });

    it("starts audio without route options, even with a value left by the retired audio-route setting", async () => {
      localStorage.setItem("c64u_dev_mode_enabled", "1");
      localStorage.setItem("c64u_stream_audio_route", "wifi");
      const { session, audio } = makeSession();
      await session.startAudio();
      expect(audio.start).toHaveBeenCalledTimes(1);
      expect(audio.start).toHaveBeenCalledWith();
    });

    it("starting and stopping video leaves a live audio stream untouched", async () => {
      const { session, audio, video } = makeSession();
      audio.deps.onChange({ state: "live", droppedPackets: 0, error: null });
      await session.startVideo();
      await session.stopVideo();
      expect(video.start).toHaveBeenCalledTimes(1);
      expect(video.stop).toHaveBeenCalledTimes(1);
      expect(audio.start).not.toHaveBeenCalled();
      expect(audio.stop).not.toHaveBeenCalled();
      expect(session.getSnapshot().video.error).toBeNull();
    });
  });

  describe("operation serialization (serialize())", () => {
    /** Drain all pending microtasks (a macrotask boundary flushes the microtask queue). */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("does not let a concurrent stop interleave with an in-flight start", async () => {
      // Regression for the serialize() op-chain: an audio toggle must run to completion before the next op begins, so late continuations
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

  // HARD27-005: the audio and video streams come from the same machine on two multicast groups, so
  // an address that is wrong for one is wrong for the other. Adopting a sender therefore retargets
  // both, and a user told which address to use is not told twice.
  it("adopts a sender on both streams at once", async () => {
    const { session, audio, video } = makeSession();

    await session.adoptSender("192.0.2.131");

    expect(audio.adoptSender).toHaveBeenCalledWith("192.0.2.131");
    expect(video.adoptSender).toHaveBeenCalledWith("192.0.2.131");
  });

  it("accepts the stream on its own when the refused sender is the selected device on another address", async () => {
    audioInstances.length = 0;
    videoInstances.length = 0;
    const judgeStreamSender = vi.fn(async () => "same" as const);
    const session = new AvMirrorSession({
      startStream: vi.fn(async () => ({})),
      stopStream: vi.fn(async () => ({})),
      judgeStreamSender,
    });
    const [audio, video] = [audioInstances[0]!, videoInstances[0]!];
    const refused = { source: "192.0.2.46", expected: "c64u", rejectedPackets: 12 };
    const report = () =>
      (audio.deps.onChange as (s: unknown) => void)({
        state: "live",
        droppedPackets: 0,
        error: "Audio packets are arriving from 192.0.2.46 and being dropped",
        foreignSenderNotice: null,
        senderMismatch: refused,
      });

    report();
    report();
    await vi.waitFor(() => expect(audio.adoptSender).toHaveBeenCalledWith("192.0.2.46"));

    expect(video.adoptSender).toHaveBeenCalledWith("192.0.2.46");
    expect(judgeStreamSender).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().audio.senderMismatch).toEqual(refused);
  });

  it("leaves a refused sender that is a different device for the user to decide", async () => {
    audioInstances.length = 0;
    videoInstances.length = 0;
    const judgeStreamSender = vi.fn(async (): Promise<"same" | "different" | "unknown"> => "different");
    new AvMirrorSession({
      startStream: vi.fn(async () => ({})),
      stopStream: vi.fn(async () => ({})),
      judgeStreamSender,
    });
    const audio = audioInstances[0]!;
    (audio.deps.onChange as (s: unknown) => void)({
      state: "live",
      droppedPackets: 0,
      error: "dropped",
      foreignSenderNotice: null,
      senderMismatch: { source: "198.51.100.13", expected: "c64u", rejectedPackets: 3 },
    });

    await vi.waitFor(() => expect(judgeStreamSender).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(audio.adoptSender).not.toHaveBeenCalled();
  });

  it("keeps accepting the adopted address for the selected device when the streams are restarted", async () => {
    const { session, audio, video } = makeSession();
    const selected = (audio.deps as { expectedSenderHost: () => string }).expectedSenderHost();

    await session.adoptSender("192.0.2.47");

    for (const controller of [audio, video]) {
      const deps = controller.deps as { expectedSenderHost: () => string; createReceiver: (o: object) => unknown };
      expect(deps.expectedSenderHost()).toBe("192.0.2.47");
      deps.createReceiver({ name: controller === audio ? "audio" : "video" });
    }
    expect(createStreamReceiverMock).toHaveBeenCalledTimes(2);
    for (const [options] of createStreamReceiverMock.mock.calls) {
      expect(options).toMatchObject({ expectedSource: "192.0.2.47" });
    }
    expect(selected).not.toBe("192.0.2.47");
  });

  it("checks a refused sender again after an earlier check found it was not the selected device", async () => {
    audioInstances.length = 0;
    videoInstances.length = 0;
    const judgeStreamSender = vi.fn(async (): Promise<"same" | "different" | "unknown"> => "different");
    new AvMirrorSession({
      startStream: vi.fn(async () => ({})),
      stopStream: vi.fn(async () => ({})),
      judgeStreamSender,
    });
    const audio = audioInstances[0]!;
    const report = () =>
      (audio.deps.onChange as (s: unknown) => void)({
        state: "live",
        droppedPackets: 0,
        error: "dropped",
        foreignSenderNotice: null,
        senderMismatch: { source: "192.0.2.47", expected: "192.0.2.46", rejectedPackets: 3 },
      });

    report();
    await vi.waitFor(() => expect(judgeStreamSender).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    judgeStreamSender.mockResolvedValueOnce("same");
    report();

    await vi.waitFor(() => expect(audio.adoptSender).toHaveBeenCalledWith("192.0.2.47"));
    expect(judgeStreamSender).toHaveBeenCalledTimes(2);
  });

  it("lets the uninvited-sender guard stop only a sender proven to be another machine", async () => {
    audioInstances.length = 0;
    videoInstances.length = 0;
    const judgeStreamSender = vi.fn(
      async (source: string) =>
        (source === "192.0.2.47" ? "same" : source === "192.0.2.48" ? "unknown" : "different") as
          "same" | "different" | "unknown",
    );
    new AvMirrorSession({
      startStream: vi.fn(async () => ({})),
      stopStream: vi.fn(async () => ({})),
      judgeStreamSender,
    });
    const deps = audioInstances[0]!.deps as { isForeignSender: (host: string) => Promise<boolean> };

    expect(await deps.isForeignSender("192.0.2.47")).toBe(false);
    expect(await deps.isForeignSender("192.0.2.48")).toBe(false);
    expect(await deps.isForeignSender("198.51.100.13")).toBe(true);
  });

  it("adopts on the stream that can, when the other refuses", async () => {
    const { session, audio, video } = makeSession();
    audio.adoptSender?.mockRejectedValueOnce(new Error("socket closed"));

    await expect(session.adoptSender("192.0.2.131")).resolves.toBeUndefined();

    expect(video.adoptSender).toHaveBeenCalledWith("192.0.2.131");
  });

  // The mirror claims the phone's speaker when its audio starts, so that a local tune is silenced
  // before the first C64 packet arrives. The other half of that bargain is being evicted when the
  // tune claims it back: if the mirror does not stop, both play at once.
  describe("phone-audio eviction", () => {
    beforeEach(() => {
      __resetPhoneAudioOwnership();
    });

    it("stops mirror audio when another source claims the speaker", async () => {
      const { session, audio } = makeSession();
      await session.startAudio();
      audio.stop.mockClear();

      claimPhoneAudio("local-sid", {}, vi.fn(), { pause: vi.fn(), resume: vi.fn() });
      await vi.waitFor(() => {
        expect(audio.stop).toHaveBeenCalled();
      });
    });

    it("logs at warn when stopping or restarting mirror audio for an audio focus change fails", async () => {
      const { session, audio } = makeSession();
      await session.startAudio();
      vi.mocked(addLog).mockClear();
      audio.stop.mockRejectedValueOnce(new Error("streams:stop refused"));
      audio.start.mockRejectedValueOnce(new Error("streams:start refused"));

      const interrupted = interruptPhoneAudio();
      await vi.waitFor(() => {
        expect(addLog).toHaveBeenCalledWith(
          "warn",
          "A/V mirror: audio focus pause failed",
          expect.objectContaining({ error: "streams:stop refused" }),
        );
      });
      interrupted?.resume();
      await vi.waitFor(() => {
        expect(addLog).toHaveBeenCalledWith(
          "warn",
          "A/V mirror: audio focus resume failed",
          expect.objectContaining({ error: "streams:start refused" }),
        );
      });
    });

    it("logs a non-Error audio focus failure as its string form without a stack", async () => {
      const { session, audio } = makeSession();
      await session.startAudio();
      vi.mocked(addLog).mockClear();
      audio.stop.mockRejectedValueOnce("native audio track already released");

      interruptPhoneAudio();
      await vi.waitFor(() => {
        expect(addLog).toHaveBeenCalledWith("warn", "A/V mirror: audio focus pause failed", {
          service: "streams",
          error: "native audio track already released",
          stack: undefined,
        });
      });
    });

    it("logs rather than throwing when the eviction stop fails", async () => {
      const { session, audio } = makeSession();
      await session.startAudio();
      audio.stop.mockRejectedValueOnce(new Error("streams:stop refused"));

      expect(() => claimPhoneAudio("local-sid", {}, vi.fn(), { pause: vi.fn(), resume: vi.fn() })).not.toThrow();
      await vi.waitFor(() => {
        expect(audio.stop).toHaveBeenCalled();
      });
    });
  });
});

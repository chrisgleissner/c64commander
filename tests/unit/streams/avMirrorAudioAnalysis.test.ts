/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Once the native sink owns playback, the Android receive thread stops emitting audio datagrams —
 * ~250 base64 encodes and WebView crossings a second that nobody was reading. The in-app analysers
 * are the exception: they measure the received stream in JS, so the packets have to come back while
 * one is listening.
 *
 * Without this the A/V-sync check and the tone & colour ladder would grade SILENCE on Android and
 * report a fault that is really a missing feed — a measurement failure that looks exactly like the
 * device failures they exist to find, which is the worst kind.
 */

const { setAudioAnalysis } = vi.hoisted(() => ({ setAudioAnalysis: vi.fn(async () => {}) }));

// Keep the real module: other modules call registerPlugin at import time, so replacing it wholesale
// breaks collection long before this test runs.
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isPluginAvailable: () => true } };
});
vi.mock("@/lib/native/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native/platform")>();
  return { ...actual, isNativePlatform: () => true };
});
vi.mock("@/lib/native/streamUdp", () => ({ StreamUdp: { setAudioAnalysis } }));
vi.mock("@/lib/streams/audioMirrorController", () => ({
  AudioMirrorController: class {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    isOnWifi = vi.fn(() => false);
  },
}));
vi.mock("@/lib/streams/videoMirrorController", () => ({
  VideoMirrorController: class {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
  },
}));

import { AvMirrorSession } from "@/lib/streams/avMirrorSession";

const makeSession = () =>
  new AvMirrorSession({ startStream: vi.fn(async () => ({})), stopStream: vi.fn(async () => ({})) });

describe("native audio analysis follows the subscribers", () => {
  beforeEach(() => {
    setAudioAnalysis.mockClear();
  });

  it("stays off until something is actually listening", () => {
    makeSession();

    expect(setAudioAnalysis).not.toHaveBeenCalled();
  });

  it("turns on for the first subscriber and off again when the last one leaves", () => {
    const session = makeSession();

    const stop = session.subscribeAudio(() => {});
    expect(setAudioAnalysis).toHaveBeenCalledWith({ enabled: true });

    setAudioAnalysis.mockClear();
    stop();
    expect(setAudioAnalysis).toHaveBeenCalledWith({ enabled: false });
  });

  it("toggles once, not per subscriber", () => {
    const session = makeSession();

    const first = session.subscribeAudio(() => {});
    const second = session.subscribeAudio(() => {});
    expect(setAudioAnalysis).toHaveBeenCalledTimes(1);

    // Still one listener left, so the feed must stay up.
    first();
    expect(setAudioAnalysis).toHaveBeenCalledTimes(1);

    second();
    expect(setAudioAnalysis).toHaveBeenCalledTimes(2);
    expect(setAudioAnalysis).toHaveBeenLastCalledWith({ enabled: false });
  });

  it("survives the plugin rejecting, because a measurement is not worth a crash", async () => {
    setAudioAnalysis.mockRejectedValueOnce(new Error("not implemented"));
    const session = makeSession();

    expect(() => session.subscribeAudio(() => {})).not.toThrow();
    await Promise.resolve();
  });
});

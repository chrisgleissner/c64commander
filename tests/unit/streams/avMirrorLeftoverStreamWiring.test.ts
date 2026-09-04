/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HARD27-021. The record that lets the next launch stop a stream the device is still sending is
 * only worth anything if the session actually writes it. The controllers are mocked so the two
 * default transport closures can be called directly — they are the code under test here.
 */

interface CapturedDeps {
  startStream: (name: "audio" | "video", destination: string, options?: { wifi?: boolean }) => Promise<unknown>;
  stopStream: (name: "audio" | "video") => Promise<unknown>;
}

const { audioDeps, videoDeps } = vi.hoisted(() => ({
  audioDeps: [] as CapturedDeps[],
  videoDeps: [] as CapturedDeps[],
}));

vi.mock("@/lib/streams/audioMirrorController", () => ({
  AudioMirrorController: class {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    isOnWifi = vi.fn(() => false);
    constructor(deps: CapturedDeps) {
      audioDeps.push(deps);
    }
  },
}));

vi.mock("@/lib/streams/videoMirrorController", () => ({
  VideoMirrorController: class {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    constructor(deps: CapturedDeps) {
      videoDeps.push(deps);
    }
  },
}));

const { api } = vi.hoisted(() => ({
  api: {
    startStream: vi.fn(async () => ({ errors: [] })),
    stopStream: vi.fn(async () => ({ errors: [] })),
    getDeviceHost: vi.fn(() => "192.168.1.10"),
  },
}));

vi.mock("@/lib/c64api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/c64api")>("@/lib/c64api");
  return { ...actual, getC64API: () => api };
});

import { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { getLeftoverDeviceStreamsForTests } from "@/lib/streams/leftoverDeviceStreams";

describe("A/V mirror records what the device is streaming (HARD27-021)", () => {
  beforeEach(() => {
    localStorage.clear();
    audioDeps.length = 0;
    videoDeps.length = 0;
    api.startStream.mockClear();
    api.stopStream.mockClear();
    api.startStream.mockResolvedValue({ errors: [] });
    api.stopStream.mockResolvedValue({ errors: [] });
  });

  const build = () => {
    new AvMirrorSession();
    return { audio: audioDeps.at(-1)!, video: videoDeps.at(-1)! };
  };

  it("records the selected device's host after a successful start", async () => {
    const { audio, video } = build();

    await audio.startStream("audio", "239.0.1.65:11001");
    await video.startStream("video", "239.0.1.64:11000");

    expect(getLeftoverDeviceStreamsForTests()).toEqual({ audio: "192.168.1.10", video: "192.168.1.10" });
  });

  it("clears the record after a successful stop", async () => {
    const { audio, video } = build();
    await audio.startStream("audio", "239.0.1.65:11001");
    await video.startStream("video", "239.0.1.64:11000");

    await audio.stopStream("audio");
    await video.stopStream("video");

    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("keeps the record when the stop fails, because the device may still be streaming", async () => {
    const { video } = build();
    await video.startStream("video", "239.0.1.64:11000");
    api.stopStream.mockRejectedValueOnce(new Error("Network error"));

    await expect(video.stopStream("video")).rejects.toThrow("Network error");

    expect(getLeftoverDeviceStreamsForTests()).toEqual({ video: "192.168.1.10" });
  });

  it("records nothing when the start fails", async () => {
    const { video } = build();
    api.startStream.mockRejectedValueOnce(new Error("Network Host Resolve Error"));

    await expect(video.startStream("video", "239.0.1.64:11000")).rejects.toThrow();

    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("leaves an injected transport alone, so the web bridge and tests record nothing", async () => {
    const startStream = vi.fn(async () => ({ errors: [] }));
    const stopStream = vi.fn(async () => ({ errors: [] }));
    new AvMirrorSession({ startStream, stopStream });
    const audio = audioDeps.at(-1)!;

    await audio.startStream("audio", "239.0.1.65:11001");

    expect(startStream).toHaveBeenCalledTimes(1);
    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });
});

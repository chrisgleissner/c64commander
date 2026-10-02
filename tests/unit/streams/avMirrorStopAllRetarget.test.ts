/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A device switch waits only a bounded time for `stopAll`, then retargets the API. A stop queued
 * behind a slow start therefore runs after the retarget, and must still reach the device that was
 * selected when the stop was requested. The controllers are mocked to call the session's default
 * transport closures, which are the code under test.
 */

interface CapturedDeps {
  startStream: (name: "audio" | "video", destination: string) => Promise<unknown>;
  stopStream: (name: "audio" | "video") => Promise<unknown>;
}

vi.mock("@/lib/streams/audioMirrorController", () => ({
  AudioMirrorController: class {
    constructor(private readonly deps: CapturedDeps) {}
    start = () => this.deps.startStream("audio", "239.0.1.65:11001");
    stop = () => this.deps.stopStream("audio");
  },
}));

vi.mock("@/lib/streams/videoMirrorController", () => ({
  VideoMirrorController: class {
    constructor(private readonly deps: CapturedDeps) {}
    start = () => this.deps.startStream("video", "239.0.1.64:11000");
    stop = () => this.deps.stopStream("video");
  },
}));

const { api, stopStreamAtHost, selected } = vi.hoisted(() => ({
  selected: { host: "192.0.2.10" },
  api: {
    startStream: vi.fn(async () => ({ errors: [] }) as unknown),
    stopStream: vi.fn(async () => ({ errors: [] })),
    getDeviceHost: vi.fn(() => "192.0.2.10"),
  },
  stopStreamAtHost: vi.fn(async () => ({ errors: [] })),
}));

vi.mock("@/lib/c64api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/c64api")>("@/lib/c64api");
  return { ...actual, getC64API: () => api };
});

vi.mock("@/lib/streams/foreignSenderStop", async () => {
  const actual = await vi.importActual<typeof import("@/lib/streams/foreignSenderStop")>(
    "@/lib/streams/foreignSenderStop",
  );
  return { ...actual, stopStreamAtHost };
});

import { AvMirrorSession } from "@/lib/streams/avMirrorSession";

describe("A/V mirror stopAll across a device retarget", () => {
  beforeEach(() => {
    localStorage.clear();
    selected.host = "192.0.2.10";
    api.getDeviceHost.mockImplementation(() => selected.host);
    api.startStream.mockReset().mockResolvedValue({ errors: [] });
    api.stopStream.mockClear();
    stopStreamAtHost.mockClear();
  });

  it("stops the streams on the device selected when the stop was requested, even if it runs after the retarget", async () => {
    let releaseStart!: () => void;
    api.startStream.mockImplementationOnce(
      () => new Promise((resolve) => (releaseStart = () => resolve({ errors: [] }))),
    );
    const session = new AvMirrorSession();

    const slowStart = session.startVideo();
    const stopping = session.stopAll();
    await vi.waitFor(() => expect(api.startStream).toHaveBeenCalled());
    selected.host = "192.0.2.20";
    releaseStart();
    await slowStart;
    await stopping;

    expect(stopStreamAtHost).toHaveBeenCalledWith("192.0.2.10", "audio");
    expect(stopStreamAtHost).toHaveBeenCalledWith("192.0.2.10", "video");
    expect(api.stopStream).not.toHaveBeenCalled();
  });

  it("resends a stop that the retarget dropped from the request queue to the device it was meant for", async () => {
    let dropAudioStop!: () => void;
    api.stopStream.mockImplementation(
      (name: "audio" | "video") =>
        new Promise((resolve, reject) => {
          if (name === "audio") {
            dropAudioStop = () => reject(new Error("rest queued task cancelled: saved-device-switch"));
          } else {
            resolve({ errors: [] });
          }
        }),
    );
    const session = new AvMirrorSession();

    const stopping = session.stopAll();
    await vi.waitFor(() => expect(api.stopStream).toHaveBeenCalledWith("audio"));
    selected.host = "192.0.2.20";
    dropAudioStop();
    await stopping;

    expect(stopStreamAtHost).toHaveBeenCalledWith("192.0.2.10", "audio");
    expect(stopStreamAtHost).not.toHaveBeenCalledWith("192.0.2.20", expect.anything());
    api.stopStream.mockReset().mockResolvedValue({ errors: [] });
  });

  it("does not resend a failed stop when the selected device did not change", async () => {
    api.stopStream.mockRejectedValueOnce(new Error("HTTP 500"));
    const session = new AvMirrorSession();

    await session.stopAll();

    expect(stopStreamAtHost).not.toHaveBeenCalled();
    api.stopStream.mockReset().mockResolvedValue({ errors: [] });
  });

  it("stops through the selected device's client when no retarget happened", async () => {
    const session = new AvMirrorSession();

    await session.stopAll();

    expect(api.stopStream).toHaveBeenCalledWith("audio");
    expect(api.stopStream).toHaveBeenCalledWith("video");
    expect(stopStreamAtHost).not.toHaveBeenCalled();
  });
});

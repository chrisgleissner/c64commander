/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { AvMirrorBackgroundPolicy, installAvMirrorBackgroundPolicy } from "@/lib/streams/avMirrorBackgroundPolicy";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const runtime = vi.hoisted(() => ({ remote: true, mirror: true, running: true, background: true }));
vi.mock("@/lib/playback/activePlaybackSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/playback/activePlaybackSession")>()),
  isRemotePlaybackActive: () => runtime.remote,
}));
vi.mock("@/lib/config/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/appSettings")>()),
  loadMirrorC64Audio: () => runtime.mirror,
}));
vi.mock("@/lib/deviceInteraction/machineExecutionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deviceInteraction/machineExecutionStore")>()),
  getMachineExecutionSnapshot: () => ({ state: runtime.running ? "running" : "paused" }),
}));
vi.mock("@/lib/native/backgroundExecutionManager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/backgroundExecutionManager")>()),
  isBackgroundExecutionActive: () => runtime.background,
}));
import { avMirrorSession } from "@/lib/streams/avMirrorSession";
import { addLog } from "@/lib/logging";
import { notifyPlaybackActivityChanged } from "@/lib/playback/playbackActivitySignal";

/** A session stub whose live flags follow the start/stop calls, like the real one. */
const createSession = (initial: { audioLive: boolean; videoLive: boolean }) => {
  const state = { ...initial };
  const calls: string[] = [];
  return {
    calls,
    get audioLive() {
      return state.audioLive;
    },
    get videoLive() {
      return state.videoLive;
    },
    setLive(next: Partial<typeof state>) {
      Object.assign(state, next);
    },
    stopVideo: vi.fn(async () => {
      calls.push("stopVideo");
      state.videoLive = false;
    }),
    stopAll: vi.fn(async () => {
      calls.push("stopAll");
      state.audioLive = false;
      state.videoLive = false;
    }),
    startAudio: vi.fn(async () => {
      calls.push("startAudio");
      state.audioLive = true;
    }),
    startVideo: vi.fn(async () => {
      calls.push("startVideo");
      state.videoLive = true;
    }),
  };
};

describe("AvMirrorBackgroundPolicy (HARD27-021)", () => {
  it("stops both streams when the app is hidden while the mirror is live", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();

    expect(session.stopAll).toHaveBeenCalledTimes(1);
    expect(policy.suspendedState).toEqual({ audioWasLive: true, videoWasLive: true });
  });

  it("keeps playlist-owned background audio running while suspending video", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session, {
      deviceOutOfReach: () => false,
      phoneIsPlaying: () => false,
      restoreWhenDeviceReturns: vi.fn(),
      playlistOwnsBackgroundAudio: () => true,
    });
    await policy.handleHidden();
    expect(session.audioLive).toBe(true);
    expect(session.calls).toEqual(["stopVideo"]);
    expect(policy.suspendedState).toEqual({ audioWasLive: false, videoWasLive: true });
    await policy.handleVisible();
    expect(session.calls).toEqual(["stopVideo", "startVideo"]);
  });

  it("does not resurrect playlist audio stopped while hidden", async () => {
    const session = createSession({ audioLive: true, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session, {
      deviceOutOfReach: () => false,
      phoneIsPlaying: () => false,
      restoreWhenDeviceReturns: vi.fn(),
      playlistOwnsBackgroundAudio: () => true,
    });
    await policy.handleHidden();
    expect(session.audioLive).toBe(true);
    expect(session.calls).toEqual([]);
    session.setLive({ audioLive: false });
    await policy.handleVisible();
    expect(session.startAudio).not.toHaveBeenCalled();
  });

  it("stops playlist audio kept while hidden once the playlist stops, without restoring it", async () => {
    let playlistOwnsAudio = true;
    const session = createSession({ audioLive: true, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session, {
      deviceOutOfReach: () => false,
      phoneIsPlaying: () => false,
      restoreWhenDeviceReturns: vi.fn(),
      playlistOwnsBackgroundAudio: () => playlistOwnsAudio,
    });
    await policy.handleHidden();
    await policy.handlePlaybackChanged();
    expect(session.calls).toEqual([]);

    playlistOwnsAudio = false;
    await policy.handlePlaybackChanged();
    expect(session.calls).toEqual(["stopAll"]);

    await policy.handleVisible();
    expect(session.startAudio).not.toHaveBeenCalled();
  });

  it("sends no stop when the kept audio has already ended by the time the playlist stops", async () => {
    let playlistOwnsAudio = true;
    const session = createSession({ audioLive: true, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session, {
      deviceOutOfReach: () => false,
      phoneIsPlaying: () => false,
      restoreWhenDeviceReturns: vi.fn(),
      playlistOwnsBackgroundAudio: () => playlistOwnsAudio,
    });
    await policy.handleHidden();
    session.setLive({ audioLive: false });
    playlistOwnsAudio = false;
    await policy.handlePlaybackChanged();

    expect(session.stopAll).not.toHaveBeenCalled();
  });

  it("leaves Live View audio alone when playback changes while hidden without the playlist keeping it", async () => {
    const session = createSession({ audioLive: true, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session, {
      deviceOutOfReach: () => false,
      phoneIsPlaying: () => false,
      restoreWhenDeviceReturns: vi.fn(),
      playlistOwnsBackgroundAudio: () => false,
    });
    await policy.handleHidden();
    expect(session.calls).toEqual(["stopAll"]);
    await policy.handlePlaybackChanged();
    expect(session.calls).toEqual(["stopAll"]);
    await policy.handleVisible();
    expect(session.startAudio).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the app is hidden and the mirror is off", async () => {
    const session = createSession({ audioLive: false, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();

    expect(session.stopAll).not.toHaveBeenCalled();
    expect(policy.suspendedState).toBeNull();
  });

  it("restarts only the streams that were live when the app becomes visible again", async () => {
    const session = createSession({ audioLive: true, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleVisible();

    expect(session.startAudio).toHaveBeenCalledTimes(1);
    expect(session.startVideo).not.toHaveBeenCalled();
    expect(policy.suspendedState).toBeNull();
  });

  it("stops before it restarts, so the device is never asked to start a stream it is still sending", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleVisible();

    expect(session.calls).toEqual(["stopAll", "startVideo", "startAudio"]);
  });

  // Away from home with the phone in a pocket: the tune had moved to the phone, and taking the phone out
  // restarted the C64's audio, which stopped the tune and then failed to bind with no network.
  it("keeps the mirror off while the device is out of reach, and leaves it to come back with the device", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const restoreWhenDeviceReturns = vi.fn();
    const policy = new AvMirrorBackgroundPolicy(session, {
      deviceOutOfReach: () => true,
      phoneIsPlaying: () => false,
      restoreWhenDeviceReturns,
    });

    await policy.handleHidden();
    await policy.handleVisible();

    expect(session.startAudio).not.toHaveBeenCalled();
    expect(session.startVideo).not.toHaveBeenCalled();
    expect(restoreWhenDeviceReturns).toHaveBeenCalledWith({ audioWasLive: true, videoWasLive: true });
  });

  it("brings the picture back but not the C64's audio over a tune playing on the phone", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session, {
      deviceOutOfReach: () => false,
      phoneIsPlaying: () => true,
      restoreWhenDeviceReturns: vi.fn(),
    });

    await policy.handleHidden();
    await policy.handleVisible();

    expect(session.calls).toEqual(["stopAll", "startVideo"]);
  });

  it("does not restart a stream that something else already restarted", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    // A device retarget followed the mirror to the new device while the app was hidden.
    session.setLive({ audioLive: true, videoLive: true });
    await policy.handleVisible();

    expect(session.startAudio).not.toHaveBeenCalled();
    expect(session.startVideo).not.toHaveBeenCalled();
  });

  it("keeps the first recorded state when hidden fires twice without an intervening visible", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleHidden();

    expect(session.stopAll).toHaveBeenCalledTimes(1);
    expect(policy.suspendedState).toEqual({ audioWasLive: true, videoWasLive: true });
  });

  it("does not restart anything when visible fires without a preceding hidden", async () => {
    const session = createSession({ audioLive: false, videoLive: false });
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleVisible();

    expect(session.startAudio).not.toHaveBeenCalled();
    expect(session.startVideo).not.toHaveBeenCalled();
  });

  // Found on the Pixel 4: returning to the app delivered a second hidden/visible pair while the
  // restore was still running its two starts. Unserialised, the trace read
  // video:start, audio:stop, video:stop, audio:start — the user came back to audio and no picture.
  it("applies a hidden that arrives mid-restore after the restore, not between its two starts", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);
    // Hidden fires again the moment the restore's first start lands, as it did on the device.
    session.startVideo.mockImplementationOnce(async () => {
      session.calls.push("startVideo");
      session.setLive({ videoLive: true });
      void policy.handleHidden();
    });

    await policy.handleHidden();
    await policy.handleVisible();
    await policy.handleVisible();

    expect(session.calls).toEqual(["stopAll", "startVideo", "startAudio", "stopAll", "startVideo", "startAudio"]);
    expect(session.audioLive).toBe(true);
    expect(session.videoLive).toBe(true);
  });

  it.each(["Audio", "Video"] as const)(
    "logs native string %s restore failures without inventing a stack",
    async (stream) => {
      const session = createSession({ audioLive: true, videoLive: true });
      session[`start${stream}`].mockRejectedValueOnce("native restore refused");
      const policy = new AvMirrorBackgroundPolicy(session);
      await policy.handleHidden();
      await policy.handleVisible();
      expect(addLog).toHaveBeenCalledWith(
        "warn",
        `Live View: failed to restart ${stream.toLowerCase()} after the app became visible`,
        { service: "streams", error: "native restore refused", stack: undefined },
      );
    },
  );

  it("still clears the held state when a restart fails, so the next hide records afresh", async () => {
    const session = createSession({ audioLive: true, videoLive: false });
    session.startAudio.mockRejectedValueOnce(new Error("streams:start refused"));
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleVisible();

    expect(policy.suspendedState).toBeNull();
  });

  // Video and audio are restarted by separate awaited calls with their own handlers, so a failing
  // video restart is a distinct path from a failing audio one — and it must still let the audio
  // restart run rather than abandoning the rest of the restore.
  it("restarts audio even when the video restart fails", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    session.startVideo.mockRejectedValueOnce(new Error("streams:start refused"));
    const policy = new AvMirrorBackgroundPolicy(session);

    await policy.handleHidden();
    await policy.handleVisible();

    expect(session.startVideo).toHaveBeenCalledTimes(1);
    expect(session.startAudio).toHaveBeenCalledTimes(1);
    expect(policy.suspendedState).toBeNull();
  });
});

describe("installAvMirrorBackgroundPolicy (HARD27-021)", () => {
  beforeEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  };

  it.each(["remote", "mirror", "running", "background"] as const)(
    "stops hidden audio when playlist background ownership lacks %s",
    async (missing) => {
      Object.assign(runtime, { remote: true, mirror: true, running: true, background: true });
      runtime[missing] = false;
      const live = vi.spyOn(avMirrorSession, "audioLive", "get").mockReturnValue(true);
      const video = vi.spyOn(avMirrorSession, "videoLive", "get").mockReturnValue(false);
      const stop = vi.spyOn(avMirrorSession, "stopAll").mockResolvedValue();
      const dispose = installAvMirrorBackgroundPolicy();
      try {
        setHidden(true);
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
      } finally {
        dispose();
        live.mockRestore();
        video.mockRestore();
        stop.mockRestore();
      }
    },
  );

  it("retains audio when all playlist background ownership conditions hold", async () => {
    Object.assign(runtime, { remote: true, mirror: true, running: true, background: true });
    const live = vi.spyOn(avMirrorSession, "audioLive", "get").mockReturnValue(true);
    const video = vi.spyOn(avMirrorSession, "videoLive", "get").mockReturnValue(true);
    const stop = vi.spyOn(avMirrorSession, "stopVideo").mockResolvedValue();
    const stopAll = vi.spyOn(avMirrorSession, "stopAll").mockResolvedValue();
    const dispose = installAvMirrorBackgroundPolicy();
    try {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
      expect(stopAll).not.toHaveBeenCalled();
    } finally {
      dispose();
      live.mockRestore();
      video.mockRestore();
      stop.mockRestore();
      stopAll.mockRestore();
    }
  });

  it.each([new Error("stream stop refused"), "native stream stop refused"])(
    "logs a failed hidden transition with its original error and stack: %s",
    async (error) => {
      const session = createSession({ audioLive: true, videoLive: true });
      session.stopAll.mockRejectedValueOnce(error);
      const dispose = installAvMirrorBackgroundPolicy(new AvMirrorBackgroundPolicy(session));
      try {
        setHidden(true);
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.waitFor(() =>
          expect(addLog).toHaveBeenCalledWith(
            "error",
            "Live View: visibility transition failed",
            expect.objectContaining({
              error: error instanceof Error ? error.message : error,
              stack: error instanceof Error ? error.stack : undefined,
              hidden: true,
            }),
          ),
        );
      } finally {
        dispose();
      }
    },
  );

  it("stops hidden playlist audio when playback stops while the app is hidden", async () => {
    Object.assign(runtime, { remote: true, mirror: true, running: true, background: true });
    const live = vi.spyOn(avMirrorSession, "audioLive", "get").mockReturnValue(true);
    const video = vi.spyOn(avMirrorSession, "videoLive", "get").mockReturnValue(false);
    const stopAll = vi.spyOn(avMirrorSession, "stopAll").mockResolvedValue();
    const dispose = installAvMirrorBackgroundPolicy();
    try {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      notifyPlaybackActivityChanged();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(stopAll).not.toHaveBeenCalled();

      runtime.remote = false;
      notifyPlaybackActivityChanged();
      await vi.waitFor(() => expect(stopAll).toHaveBeenCalledTimes(1));
    } finally {
      dispose();
      runtime.remote = true;
      live.mockRestore();
      video.mockRestore();
      stopAll.mockRestore();
    }
  });

  it("releases playlist audio only while hidden, and logs a release that fails", async () => {
    const policy = new AvMirrorBackgroundPolicy(createSession({ audioLive: true, videoLive: false }));
    const release = vi.spyOn(policy, "handlePlaybackChanged").mockRejectedValue(new Error("stop refused"));
    const dispose = installAvMirrorBackgroundPolicy(policy);
    try {
      notifyPlaybackActivityChanged();
      expect(release).not.toHaveBeenCalled();

      setHidden(true);
      notifyPlaybackActivityChanged();
      await vi.waitFor(() =>
        expect(addLog).toHaveBeenCalledWith(
          "error",
          "Live View: releasing hidden playlist audio failed",
          expect.objectContaining({ error: "stop refused", stack: expect.any(String) }),
        ),
      );
    } finally {
      dispose();
    }
  });

  it("drives the policy from visibilitychange and stops driving it after disposal", async () => {
    const session = createSession({ audioLive: true, videoLive: true });
    const policy = new AvMirrorBackgroundPolicy(session);
    const dispose = installAvMirrorBackgroundPolicy(policy);

    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(session.stopAll).toHaveBeenCalledTimes(1));

    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(session.startVideo).toHaveBeenCalledTimes(1));

    dispose();
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(session.stopAll).toHaveBeenCalledTimes(1);
  });
});

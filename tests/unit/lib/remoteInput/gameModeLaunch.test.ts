/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const flags: Record<string, boolean> = {
  live_view_enabled: true,
  audio_mirror_enabled: true,
  video_mirror_enabled: true,
};

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

vi.mock("@/lib/config/featureFlags", () => ({
  featureFlagManager: { getSnapshot: () => ({ flags }) },
}));

import { addLog } from "@/lib/logging";
import {
  DEFAULT_GAME_MODE_ON_LAUNCH,
  loadGameModeOnLaunch,
  requestGameMode,
  resetPendingGameModeRequest,
  saveGameModeOnLaunch,
  startGameMode,
  subscribeGameModeRequest,
} from "@/lib/remoteInput/gameModeLaunch";
import type { GameModeStartResult } from "@/lib/remoteInput/gameModeLaunch";
import { avMirrorSession, type AvMirrorSession } from "@/lib/streams/avMirrorSession";

interface FakeSession {
  audioLive: boolean;
  videoLive: boolean;
  startAudio: ReturnType<typeof vi.fn>;
  startVideo: ReturnType<typeof vi.fn>;
}

const fakeSession = (overrides: Partial<FakeSession> = {}): FakeSession => ({
  audioLive: false,
  videoLive: false,
  startAudio: vi.fn(async () => {}),
  startVideo: vi.fn(async () => {}),
  ...overrides,
});

const launch = (session: FakeSession) => startGameMode({ session: session as unknown as AvMirrorSession });

describe("startGameMode", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPendingGameModeRequest();
    flags.live_view_enabled = true;
    flags.audio_mirror_enabled = true;
    flags.video_mirror_enabled = true;
  });

  it("starts both feeds when the flags and the remembered preferences are on", async () => {
    const session = fakeSession();
    const result = await launch(session);

    expect(session.startVideo).toHaveBeenCalledTimes(1);
    expect(session.startAudio).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ startedVideo: true, startedAudio: true });
  });

  it("starts nothing when the Live View master flag is off", async () => {
    flags.live_view_enabled = false;
    const session = fakeSession();
    const result = await launch(session);

    expect(session.startVideo).not.toHaveBeenCalled();
    expect(session.startAudio).not.toHaveBeenCalled();
    expect(result).toEqual({ startedVideo: false, startedAudio: false });
  });

  it("skips the feed whose own flag is off", async () => {
    flags.video_mirror_enabled = false;
    const session = fakeSession();
    const result = await launch(session);

    expect(session.startVideo).not.toHaveBeenCalled();
    expect(session.startAudio).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ startedVideo: false, startedAudio: true });
  });

  it("opens without a picture once Watch has been turned off", async () => {
    localStorage.setItem("c64u_mirror_c64_video", "0");
    const session = fakeSession();
    const result = await launch(session);

    expect(session.startVideo).not.toHaveBeenCalled();
    expect(session.startAudio).toHaveBeenCalledTimes(1);
    expect(result.startedVideo).toBe(false);
  });

  it("opens without sound once Listen has been turned off", async () => {
    localStorage.setItem("c64u_mirror_c64_audio", "0");
    const session = fakeSession();
    const result = await launch(session);

    expect(session.startAudio).not.toHaveBeenCalled();
    expect(result.startedAudio).toBe(false);
  });

  it("leaves an already-running feed alone and does not claim it as its own", async () => {
    const session = fakeSession({ audioLive: true, videoLive: true });
    const result = await launch(session);

    expect(session.startVideo).not.toHaveBeenCalled();
    expect(session.startAudio).not.toHaveBeenCalled();
    expect(result).toEqual({ startedVideo: false, startedAudio: false });
  });

  it("reports only the feed it started when the other was already running", async () => {
    const session = fakeSession({ audioLive: true });
    const result = await launch(session);

    expect(result).toEqual({ startedVideo: true, startedAudio: false });
  });

  /*
   * A cartridge (Ultimate II+L) serves no `/v1/streams`, so both starts answered 404. Each 404 was
   * recorded as a failed API request, which put "Could not tell the device to start streaming
   * audio." under the toggles and reported the device unhealthy — on a device with nothing wrong
   * with it. The sheet still has to open: driving the machine works there, only the feeds do not.
   */
  it("starts no feed on a device that cannot stream, and still opens the sheet", async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeGameModeRequest(handler);
    const session = fakeSession();

    const result = await startGameMode({
      session: session as unknown as AvMirrorSession,
      deviceStreams: false,
    });

    expect(session.startVideo).not.toHaveBeenCalled();
    expect(session.startAudio).not.toHaveBeenCalled();
    expect(result).toEqual({ startedVideo: false, startedAudio: false });
    expect(handler).toHaveBeenCalledWith({ startedVideo: false, startedAudio: false });
    unsubscribe();
  });

  it("asks the mounted sheet to open, even when no stream needed starting", async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeGameModeRequest(handler);
    await launch(fakeSession({ audioLive: true, videoLive: true }));
    expect(handler).toHaveBeenCalledWith({ startedVideo: false, startedAudio: false });
    unsubscribe();

    await launch(fakeSession());
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("the request bus", () => {
  beforeEach(() => {
    resetPendingGameModeRequest();
  });

  // Two sheets can be mounted at once while the swipe layer keeps a neighbouring
  // page alive; exactly one of them must open.
  it("is claimed by exactly one subscriber", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeGameModeRequest(first);
    const unsubscribeSecond = subscribeGameModeRequest(second);

    requestGameMode({ startedVideo: true, startedAudio: false });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    unsubscribeFirst();
    unsubscribeSecond();
  });

  // `0` on a page that hosts no sheet navigates to one; the request has to still be
  // there when that page finishes mounting.
  it("is claimed by a sheet that mounts after the request was raised", () => {
    requestGameMode({ startedVideo: false, startedAudio: true });

    const handler = vi.fn();
    const unsubscribe = subscribeGameModeRequest(handler);
    expect(handler).toHaveBeenCalledWith({ startedVideo: false, startedAudio: true });
    unsubscribe();
  });

  it("does not open a sheet that mounts long after an abandoned request", () => {
    vi.useFakeTimers();
    try {
      requestGameMode();
      vi.advanceTimersByTime(6_000);
      const handler = vi.fn();
      const unsubscribe = subscribeGameModeRequest(handler);
      expect(handler).not.toHaveBeenCalled();
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("an unclaimed request that expires", () => {
  const claimAfterExpiry = (started: GameModeStartResult) => {
    const stopVideo = vi.spyOn(avMirrorSession, "stopVideo").mockResolvedValue();
    const stopAudio = vi.spyOn(avMirrorSession, "stopAudio").mockResolvedValue();
    vi.useFakeTimers();
    try {
      requestGameMode(started);
      vi.advanceTimersByTime(6_000);
      const handler = vi.fn();
      subscribeGameModeRequest(handler)();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    return { stopVideo, stopAudio };
  };

  beforeEach(() => {
    resetPendingGameModeRequest();
    vi.restoreAllMocks();
  });

  it("stops the feeds it owns when it is claimed after the 5 s window", () => {
    const { stopVideo, stopAudio } = claimAfterExpiry({ startedVideo: true, startedAudio: true });
    expect(stopVideo).toHaveBeenCalledTimes(1);
    expect(stopAudio).toHaveBeenCalledTimes(1);
  });

  it("leaves a feed the launch did not start alone", () => {
    const { stopVideo, stopAudio } = claimAfterExpiry({ startedVideo: true, startedAudio: false });
    expect(stopVideo).toHaveBeenCalledTimes(1);
    expect(stopAudio).not.toHaveBeenCalled();
  });

  it("stops the owned feeds after the window even when no sheet ever claims it", () => {
    const stopVideo = vi.spyOn(avMirrorSession, "stopVideo").mockResolvedValue();
    const stopAudio = vi.spyOn(avMirrorSession, "stopAudio").mockResolvedValue();
    vi.useFakeTimers();
    try {
      requestGameMode({ startedVideo: false, startedAudio: true });
      vi.advanceTimersByTime(4_000);
      expect(stopAudio).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2_000);
    } finally {
      vi.useRealTimers();
    }
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(stopVideo).not.toHaveBeenCalled();
  });

  it("does not stop feeds that a sheet claimed before the window ended", () => {
    const stopVideo = vi.spyOn(avMirrorSession, "stopVideo").mockResolvedValue();
    vi.useFakeTimers();
    try {
      requestGameMode({ startedVideo: true, startedAudio: false });
      vi.advanceTimersByTime(1_000);
      const handler = vi.fn();
      subscribeGameModeRequest(handler)();
      expect(handler).toHaveBeenCalledWith({ startedVideo: true, startedAudio: false });
      vi.advanceTimersByTime(10_000);
    } finally {
      vi.useRealTimers();
    }
    expect(stopVideo).not.toHaveBeenCalled();
  });

  it("carries the ownership of an expired-but-unswept record into a replacing request", () => {
    const stopVideo = vi.spyOn(avMirrorSession, "stopVideo").mockResolvedValue();
    const handler = vi.fn();
    vi.useFakeTimers();
    try {
      requestGameMode({ startedVideo: true, startedAudio: false });
      vi.setSystemTime(Date.now() + 6_000);
      requestGameMode({ startedVideo: false, startedAudio: true });
      subscribeGameModeRequest(handler)();
      vi.advanceTimersByTime(10_000);
    } finally {
      vi.useRealTimers();
    }
    expect(handler).toHaveBeenCalledWith({ startedVideo: true, startedAudio: true });
    expect(stopVideo).not.toHaveBeenCalled();
  });

  it("logs a warning with the stack when stopping an owned feed fails", async () => {
    vi.spyOn(avMirrorSession, "stopVideo").mockRejectedValue(new Error("stop refused"));
    vi.useFakeTimers();
    try {
      requestGameMode({ startedVideo: true, startedAudio: false });
      vi.advanceTimersByTime(6_000);
      subscribeGameModeRequest(vi.fn())();
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() =>
      expect(addLog).toHaveBeenCalledWith(
        "warn",
        expect.stringContaining("failed to stop the video stream"),
        expect.objectContaining({ error: "stop refused", stack: expect.any(String) }),
      ),
    );
  });
});

describe("the auto-enter preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("follows the variant default until the user changes it", () => {
    expect(loadGameModeOnLaunch()).toBe(DEFAULT_GAME_MODE_ON_LAUNCH);
  });

  it("round-trips both explicit answers", () => {
    saveGameModeOnLaunch(true);
    expect(loadGameModeOnLaunch()).toBe(true);
    saveGameModeOnLaunch(false);
    expect(loadGameModeOnLaunch()).toBe(false);
  });

  it("falls back to the default for an unrecognised stored value", () => {
    localStorage.setItem("c64u_game_mode_on_launch", "maybe");
    expect(loadGameModeOnLaunch()).toBe(DEFAULT_GAME_MODE_ON_LAUNCH);
  });
});

// The `0` shortcut fires on every key-down, so a key repeat or a quick double-press calls
// requestGameMode twice. The second launch finds the feeds already live and reports starting
// nothing; if that replaced the record, the sheet would close without stopping the feeds the
// FIRST launch really did start, and the device would keep streaming to nobody.
describe("a repeated request keeps the stream ownership of the first", () => {
  beforeEach(() => {
    resetPendingGameModeRequest();
  });

  it("carries video and audio ownership forward when the second launch started nothing", () => {
    requestGameMode({ startedVideo: true, startedAudio: true });
    requestGameMode({ startedVideo: false, startedAudio: false });

    let claimed: GameModeStartResult | null = null;
    const stop = subscribeGameModeRequest((started) => {
      claimed = started;
    });
    stop();

    expect(claimed).toEqual({ startedVideo: true, startedAudio: true });
  });

  it("unions the two, so a feed started by either launch is owned", () => {
    requestGameMode({ startedVideo: true, startedAudio: false });
    requestGameMode({ startedVideo: false, startedAudio: true });

    let claimed: GameModeStartResult | null = null;
    const stop = subscribeGameModeRequest((started) => {
      claimed = started;
    });
    stop();

    expect(claimed).toEqual({ startedVideo: true, startedAudio: true });
  });
});

describe("an unclaimed request while a launch is still starting its feeds", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPendingGameModeRequest();
    vi.restoreAllMocks();
    flags.live_view_enabled = true;
    flags.audio_mirror_enabled = true;
    flags.video_mirror_enabled = true;
  });

  it("does not stop the feeds mid-launch, and stops audio too once the launch settled and nobody claimed it", async () => {
    const stopVideo = vi.spyOn(avMirrorSession, "stopVideo").mockResolvedValue();
    const stopAudio = vi.spyOn(avMirrorSession, "stopAudio").mockResolvedValue();
    let finishVideo: () => void = () => {};
    const session = fakeSession({ startVideo: vi.fn(() => new Promise<void>((resolve) => (finishVideo = resolve))) });
    vi.useFakeTimers();
    try {
      const launched = launch(session);
      vi.advanceTimersByTime(6_000);
      expect(stopVideo).not.toHaveBeenCalled();
      expect(stopAudio).not.toHaveBeenCalled();

      finishVideo();
      await launched;
      expect(session.startAudio).toHaveBeenCalledTimes(1);
      expect(stopAudio).not.toHaveBeenCalled();

      vi.advanceTimersByTime(6_000);
      expect(stopVideo).toHaveBeenCalledTimes(1);
      expect(stopAudio).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the request to a sheet that mounts after the 5 s window while the launch is still starting", async () => {
    vi.spyOn(avMirrorSession, "stopVideo").mockResolvedValue();
    vi.spyOn(avMirrorSession, "stopAudio").mockResolvedValue();
    let finishVideo: () => void = () => {};
    const session = fakeSession({ startVideo: vi.fn(() => new Promise<void>((resolve) => (finishVideo = resolve))) });
    vi.useFakeTimers();
    try {
      const launched = launch(session);
      vi.advanceTimersByTime(6_000);
      const handler = vi.fn();
      const unsubscribe = subscribeGameModeRequest(handler);
      expect(handler).toHaveBeenCalledWith({ startedVideo: true, startedAudio: true });
      unsubscribe();
      finishVideo();
      await launched;
    } finally {
      vi.useRealTimers();
    }
  });
});

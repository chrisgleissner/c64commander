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

vi.mock("@/lib/config/featureFlags", () => ({
  featureFlagManager: { getSnapshot: () => ({ flags }) },
}));

import {
  DEFAULT_GAME_MODE_ON_LAUNCH,
  loadGameModeOnLaunch,
  requestGameMode,
  resetPendingGameModeRequest,
  saveGameModeOnLaunch,
  startGameMode,
  subscribeGameModeRequest,
} from "@/lib/remoteInput/gameModeLaunch";
import type { AvMirrorSession } from "@/lib/streams/avMirrorSession";

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

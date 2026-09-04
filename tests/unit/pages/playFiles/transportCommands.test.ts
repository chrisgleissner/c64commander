/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTransportCommand } from "@/pages/playFiles/transportCommands";

const handlers = {
  isPlaying: false,
  isPaused: false,
  play: vi.fn(),
  pauseResume: vi.fn(),
  next: vi.fn(),
  stop: vi.fn(),
};

describe("what a transport command does on the Play page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.isPlaying = false;
    handlers.isPaused = false;
  });

  it("advances on next", () => {
    runTransportCommand("next", handlers);
    expect(handlers.next).toHaveBeenCalledTimes(1);
  });

  it("stops on stop, which a media session's STOP action can send", () => {
    runTransportCommand("stop", handlers);
    expect(handlers.stop).toHaveBeenCalledTimes(1);
    expect(handlers.pauseResume).not.toHaveBeenCalled();
  });

  it("starts on play only when nothing is playing", () => {
    runTransportCommand("play", handlers);
    expect(handlers.play).toHaveBeenCalledTimes(1);

    handlers.isPlaying = true;
    runTransportCommand("play", handlers);
    expect(handlers.play).toHaveBeenCalledTimes(1);
  });

  it("HARD27-007: resumes on play while paused, which is what a headset or lock-screen Play means", () => {
    // A paused session still reports isPlaying true, so the "start only when nothing is playing"
    // rule made this press do nothing at all.
    handlers.isPlaying = true;
    handlers.isPaused = true;

    runTransportCommand("play", handlers);

    expect(handlers.pauseResume).toHaveBeenCalledTimes(1);
    expect(handlers.play).not.toHaveBeenCalled();
  });

  it("toggles on playPause, which is what a headset play/pause button sends", () => {
    runTransportCommand("playPause", handlers);
    expect(handlers.pauseResume).toHaveBeenCalledTimes(1);
  });
});

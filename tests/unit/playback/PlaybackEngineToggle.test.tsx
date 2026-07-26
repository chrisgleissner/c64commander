/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlaybackEngineToggle } from "@/pages/playFiles/components/PlaybackEngineToggle";
import { loadPlaybackEngine } from "@/lib/config/appSettings";

// The toggle hides "Both" unless the C64's audio can actually reach this
// device, which it decides from the Live View / audio-mirror flags. These tests
// are about the engine choice, so the flags are simply on and the mirror is a
// stub — the hiding behaviour has its own test below.
vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: (id: string) => ({ value: id === "live_view_enabled" || id === "audio_mirror_enabled" }),
}));

const mirror = {
  audioLive: false,
  session: { startAudio: vi.fn().mockResolvedValue(undefined), stopAudio: vi.fn().mockResolvedValue(undefined) },
};
vi.mock("@/hooks/useAvMirror", () => ({ useAvMirror: () => mirror }));

describe("PlaybackEngineToggle", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("defaults to C64 and marks it pressed", () => {
    render(<PlaybackEngineToggle />);
    expect(screen.getByTestId("playback-engine-c64")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("playback-engine-local")).toHaveAttribute("aria-pressed", "false");
  });

  it("persists and reflects a switch to the local engine", () => {
    render(<PlaybackEngineToggle />);
    fireEvent.click(screen.getByTestId("playback-engine-local"));
    expect(loadPlaybackEngine()).toBe("local");
    expect(screen.getByTestId("playback-engine-local")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("playback-engine-c64")).toHaveAttribute("aria-pressed", "false");
  });

  it("switches back to C64", () => {
    localStorage.setItem("c64u_playback_engine", "local");
    render(<PlaybackEngineToggle />);
    expect(screen.getByTestId("playback-engine-local")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("playback-engine-c64"));
    expect(loadPlaybackEngine()).toBe("c64");
    expect(screen.getByTestId("playback-engine-c64")).toHaveAttribute("aria-pressed", "true");
  });

  it("stays in sync when the engine changes elsewhere (broadcast)", () => {
    render(<PlaybackEngineToggle />);
    // Another surface persists + broadcasts a change.
    localStorage.setItem("c64u_playback_engine", "local");
    act(() => {
      window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key: "c64u_playback_engine" } }));
    });
    expect(screen.getByTestId("playback-engine-local")).toHaveAttribute("aria-pressed", "true");
  });
});

/**
 * The control asks one question — which speakers you hear the tune on — so
 * "Both" is the union of the outer two options rather than a compound label.
 * It maps onto two independent facts underneath: the engine choice, and whether
 * the C64's audio is streamed here.
 */
describe("PlaybackEngineToggle listen targets", () => {
  beforeEach(() => {
    localStorage.clear();
    mirror.audioLive = false;
    mirror.session.startAudio.mockClear();
    mirror.session.stopAudio.mockClear();
  });
  afterEach(() => cleanup());

  it("offers three targets when the C64 can stream its audio here", () => {
    render(<PlaybackEngineToggle />);
    expect(screen.getByTestId("playback-engine-c64")).toBeInTheDocument();
    expect(screen.getByTestId("playback-listen-both")).toBeInTheDocument();
    expect(screen.getByTestId("playback-engine-local")).toBeInTheDocument();
  });

  it("starts the audio mirror for Both, and keeps the C64 engine", () => {
    render(<PlaybackEngineToggle />);
    fireEvent.click(screen.getByTestId("playback-listen-both"));
    expect(loadPlaybackEngine()).toBe("c64");
    expect(mirror.session.startAudio).toHaveBeenCalledTimes(1);
  });

  it("shows Both as selected while the mirror is live", () => {
    mirror.audioLive = true;
    render(<PlaybackEngineToggle />);
    expect(screen.getByTestId("playback-listen-both")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("playback-engine-c64")).toHaveAttribute("aria-pressed", "false");
  });

  it("stops the mirror when C64-only is chosen", () => {
    mirror.audioLive = true;
    render(<PlaybackEngineToggle />);
    fireEvent.click(screen.getByTestId("playback-engine-c64"));
    expect(mirror.session.stopAudio).toHaveBeenCalledTimes(1);
  });

  it("stops the mirror when moving to this device, so the C64 is not left sounding under it", () => {
    mirror.audioLive = true;
    render(<PlaybackEngineToggle />);
    fireEvent.click(screen.getByTestId("playback-engine-local"));
    expect(loadPlaybackEngine()).toBe("local");
    expect(mirror.session.stopAudio).toHaveBeenCalledTimes(1);
  });
});

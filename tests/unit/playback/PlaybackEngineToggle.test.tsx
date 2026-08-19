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
import { loadMirrorC64Audio, loadPlaybackEngine } from "@/lib/config/appSettings";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

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

  it("remembers that the C64's own speakers were chosen, so playback cannot undo it", () => {
    // The bug this pins: playback starts the Live View audio mirror by itself whenever a tune moves
    // to the C64, and it used to do that unconditionally. So choosing "<device>" — which means the
    // C64's speakers and nothing else — survived until the next track change, at which point the
    // phone started streaming audio the listener had just switched off. Reproduced on hardware two
    // ways: one tap from Local, and one press of Next.
    localStorage.setItem("c64u_playback_engine", "local");
    render(<PlaybackEngineToggle />);
    fireEvent.click(screen.getByTestId("playback-engine-c64"));
    expect(loadMirrorC64Audio()).toBe(false);
  });

  it("remembers that Both was chosen", () => {
    render(<PlaybackEngineToggle />);
    fireEvent.click(screen.getByTestId("playback-listen-both"));
    expect(loadMirrorC64Audio()).toBe(true);
  });

  it("leaves the C64 route's preference alone when moving to this device", () => {
    // "Local" answers a different question. A listener who had the mirror off on the C64 route
    // should still find it off when playback goes back there.
    localStorage.setItem("c64u_mirror_c64_audio", "0");
    render(<PlaybackEngineToggle />);
    fireEvent.click(screen.getByTestId("playback-engine-local"));
    expect(loadMirrorC64Audio()).toBe(false);
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

  /**
   * HARD25-007: switching to "local" silently swallowed a stopAudio() failure with
   * no logging and no reaction, while the "both"/"c64" branch a few lines below logs
   * the identical failure. A failed stop here leaves the C64's mirrored audio
   * playing audibly underneath the newly started local engine, with nothing to show
   * for it but this log.
   */
  it("logs a failed stop when moving to this device, matching the c64/both branch", async () => {
    mirror.audioLive = true;
    mirror.session.stopAudio.mockRejectedValueOnce(new Error("bridge unavailable"));
    vi.mocked(addLog).mockClear();
    render(<PlaybackEngineToggle />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("playback-engine-local"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("could not stop"),
      expect.objectContaining({ error: expect.stringContaining("bridge unavailable") }),
    );
  });

  it("labels the options Local, Remote, Both, in that order", () => {
    // The row reads as a progression from this device outwards. "Remote" rather than the device's
    // name: the header already says which device is connected, so repeating it here spent the row's
    // width on something already on screen — and the wording now matches Remote Input.
    render(<PlaybackEngineToggle />);

    const labels = ["playback-engine-local", "playback-engine-c64", "playback-listen-both"].map((id) =>
      screen.getByTestId(id).textContent?.trim(),
    );
    expect(labels).toEqual(["Local", "Remote", "Both"]);
  });

  it("does not put the connected device's name on the buttons", () => {
    render(<PlaybackEngineToggle />);

    expect(screen.getByTestId("playback-engine-toggle").textContent).not.toMatch(/192\.168|\.local/);
  });
});

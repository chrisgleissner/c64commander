/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlaybackEngineToggle } from "@/pages/playFiles/components/PlaybackEngineToggle";
import { loadPlaybackEngine } from "@/lib/config/appSettings";

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

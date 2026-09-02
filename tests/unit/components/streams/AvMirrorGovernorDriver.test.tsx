/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable stand-in for the app-wide singleton the driver ticks.
const { fakeSession } = vi.hoisted(() => ({
  fakeSession: {
    audioLive: false,
    videoLive: false,
    tick: vi.fn(),
    getStatsSnapshot: vi.fn(() => ({})),
    stopAll: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
    startVideo: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/streams/avMirrorSession", () => ({ avMirrorSession: fakeSession }));

import { AvMirrorGovernorDriver } from "@/components/streams/AvMirrorGovernorDriver";
import { STATS_TICK_MS } from "@/hooks/useStreamStats";

describe("AvMirrorGovernorDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeSession.audioLive = false;
    fakeSession.videoLive = false;
    fakeSession.tick.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("drives the app-wide governor tick on the low-rate interval while a stream is live", () => {
    fakeSession.videoLive = true;
    const { unmount } = render(<AvMirrorGovernorDriver />);
    vi.advanceTimersByTime(STATS_TICK_MS * 3 + 10);
    expect(fakeSession.tick).toHaveBeenCalledTimes(3);
    // Cleared on unmount — no leaked interval keeps ticking.
    unmount();
    vi.advanceTimersByTime(STATS_TICK_MS * 3);
    expect(fakeSession.tick).toHaveBeenCalledTimes(3);
  });

  it("does not tick while nothing is live (no idle telemetry)", () => {
    render(<AvMirrorGovernorDriver />);
    vi.advanceTimersByTime(STATS_TICK_MS * 4);
    expect(fakeSession.tick).not.toHaveBeenCalled();
  });

  it("keeps ticking regardless of any Stats panel — it is the SINGLE app-wide owner", () => {
    fakeSession.audioLive = true; // audio-only session, Stats panel never opened
    render(<AvMirrorGovernorDriver />);
    vi.advanceTimersByTime(STATS_TICK_MS * 2 + 10);
    expect(fakeSession.tick).toHaveBeenCalledTimes(2);
  });

  it("renders nothing", () => {
    const { container } = render(<AvMirrorGovernorDriver />);
    expect(container).toBeEmptyDOMElement();
  });

  // HARD27-021: before this driver owned the backgrounding policy, hiding the app left the native
  // receiver running and the Ultimate multicasting. Nothing in the app listened for the event.
  it("stops a live mirror when the app is hidden, and stops listening on unmount", () => {
    const setHidden = (hidden: boolean) =>
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    fakeSession.videoLive = true;
    fakeSession.stopAll.mockClear();
    const { unmount } = render(<AvMirrorGovernorDriver />);

    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fakeSession.stopAll).toHaveBeenCalledTimes(1);

    unmount();
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fakeSession.stopAll).toHaveBeenCalledTimes(1);
    setHidden(false);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({ active: false }));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  getSharedLocalSidPlaybackController: () => ({ isActive: () => controller.active }),
}));

import { useActivePlayback } from "@/hooks/useActivePlayback";
import {
  isAnyPlaybackActive,
  markRemotePlaybackStarted,
  markRemotePlaybackStopped,
} from "@/lib/playback/activePlaybackSession";
import { notifyPlaybackActivityChanged } from "@/lib/playback/playbackActivitySignal";

/**
 * The transport must know what is playing, wherever it is playing.
 *
 * The Play page kept that in its own `useState(false)`, so a page mounted while
 * a tune was already running — navigate Home, come back — rendered Pause
 * disabled and dropped Rewind/Fast Forward, on audio the user could hear. It
 * fixed itself once an async session restore landed, which is too late.
 */
describe("app-wide playback truth", () => {
  beforeEach(() => {
    controller.active = false;
    markRemotePlaybackStopped();
  });

  it("reports a tune already playing to a component that just mounted", () => {
    controller.active = true;

    const { result } = renderHook(() => useActivePlayback());

    // The component did nothing to start this and holds no state about it.
    expect(result.current.local).toBe(true);
    expect(result.current.any).toBe(true);
  });

  it("follows playback starting after the component mounted", () => {
    const { result } = renderHook(() => useActivePlayback());
    expect(result.current.any).toBe(false);

    act(() => {
      controller.active = true;
      notifyPlaybackActivityChanged();
    });

    expect(result.current.local).toBe(true);
  });

  it("follows playback stopping, so Pause stops being offered", () => {
    controller.active = true;
    const { result } = renderHook(() => useActivePlayback());

    act(() => {
      controller.active = false;
      notifyPlaybackActivityChanged();
    });

    expect(result.current.any).toBe(false);
  });

  it("distinguishes a tune on the C64 from one rendering here", () => {
    // Rewind/Fast Forward are only meaningful for audio this device renders —
    // the C64 plays the SID itself and cannot be scrubbed.
    const { result } = renderHook(() => useActivePlayback());

    act(() => {
      markRemotePlaybackStarted();
    });

    expect(result.current.remote).toBe(true);
    expect(result.current.local).toBe(false);
    expect(result.current.any).toBe(true);
  });

  it("counts either source as playing", () => {
    markRemotePlaybackStarted();
    expect(isAnyPlaybackActive()).toBe(true);

    markRemotePlaybackStopped();
    controller.active = true;
    expect(isAnyPlaybackActive()).toBe(true);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useActivePlayback());
    unmount();

    // Would throw on a listener still holding a torn-down component.
    expect(() => notifyPlaybackActivityChanged()).not.toThrow();
  });
});

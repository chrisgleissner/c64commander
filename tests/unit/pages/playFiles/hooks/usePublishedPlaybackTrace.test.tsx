/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { getDecisionStateSnapshot } from "@/lib/diagnostics/decisionState";
import type { TracePlaybackContext } from "@/lib/tracing/types";
import { usePublishedPlaybackTrace } from "@/pages/playFiles/hooks/usePublishedPlaybackTrace";
import { getPlaybackTraceSnapshot, setPlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";

const playing: TracePlaybackContext = {
  queueLength: 3,
  currentIndex: 1,
  currentItemId: "tune-2",
  isPlaying: true,
  elapsedMs: 12_000,
};

const renderInPlaySlot = (context: TracePlaybackContext | null, initiallyOnScreen: boolean) => {
  let playOnScreen = initiallyOnScreen;
  let published = context;
  const rendered = renderHook(() => usePublishedPlaybackTrace(published), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ScreenActivityProvider active={playOnScreen}>{children}</ScreenActivityProvider>
    ),
  });
  return {
    show: (onScreen: boolean) => {
      playOnScreen = onScreen;
      rendered.rerender();
    },
    publish: (next: TracePlaybackContext | null) => {
      published = next;
      rendered.rerender();
    },
    unmount: rendered.unmount,
  };
};

describe("usePublishedPlaybackTrace", () => {
  afterEach(() => {
    setPlaybackTraceSnapshot(null);
  });

  it("publishes the Play page's playback state while Play is on screen", () => {
    renderInPlaySlot(playing, true);
    expect(getPlaybackTraceSnapshot()).toEqual(playing);
    expect(getDecisionStateSnapshot().playback.state).toBe("PLAYING");
  });

  it("withdraws it when another tab replaces Play, as leaving used to unmount the page, and publishes it again on return", () => {
    const play = renderInPlaySlot(playing, true);
    play.show(false);
    expect(getPlaybackTraceSnapshot()).toBeNull();
    expect(getDecisionStateSnapshot().playback.state).toBe("UNKNOWN");

    const advanced = { ...playing, currentIndex: 2, currentItemId: "tune-3" };
    play.publish(advanced);
    expect(getPlaybackTraceSnapshot()).toBeNull();

    play.show(true);
    expect(getPlaybackTraceSnapshot()).toEqual(advanced);
  });

  it("withdraws it when the page unmounts", () => {
    const play = renderInPlaySlot(playing, true);
    play.unmount();
    expect(getPlaybackTraceSnapshot()).toBeNull();
  });
});

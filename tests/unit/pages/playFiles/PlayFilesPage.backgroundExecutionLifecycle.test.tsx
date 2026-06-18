import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldStartBackgroundExecution,
  shouldStopBackgroundExecution,
} from "@/pages/playFiles/backgroundExecutionPolicy";

const mocks = vi.hoisted(() => ({
  startBackgroundExecution: vi.fn(async () => undefined),
  stopBackgroundExecution: vi.fn(async () => undefined),
  isBackgroundExecutionActive: vi.fn(() => false),
}));

vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  isBackgroundExecutionActive: mocks.isBackgroundExecutionActive,
  startBackgroundExecution: mocks.startBackgroundExecution,
  stopBackgroundExecution: mocks.stopBackgroundExecution,
}));

type HarnessProps = {
  backgroundExecutionEnabled: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  trackInstanceId: number;
};

function Harness({ backgroundExecutionEnabled, isPaused, isPlaying, trackInstanceId }: HarnessProps) {
  const playbackStateRef = useRef({ isPlaying, isPaused });
  const backgroundExecutionActiveRef = useRef(mocks.isBackgroundExecutionActive());
  const hasObservedActivePlaybackRef = useRef(false);

  useEffect(() => {
    playbackStateRef.current = { isPlaying, isPaused };
    if (isPlaying) {
      hasObservedActivePlaybackRef.current = true;
    }
  }, [isPaused, isPlaying]);

  useEffect(() => {
    if (
      shouldStartBackgroundExecution({
        backgroundExecutionEnabled,
        backgroundExecutionActive: backgroundExecutionActiveRef.current,
        isPlaying,
        isPaused,
      })
    ) {
      backgroundExecutionActiveRef.current = true;
      void mocks.startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
        context: { trackInstanceId },
      });
      return;
    }

    if (
      !shouldStopBackgroundExecution({
        backgroundExecutionEnabled,
        backgroundExecutionActive: backgroundExecutionActiveRef.current,
        isPlaying,
        isPaused,
      })
    ) {
      return;
    }

    // A transient instance that only adopted the running session (never observed
    // playback) must not stop it (BUG-040). Keep the adopted flag so a later
    // restore on this instance does not double-start (BUG-025).
    if (!hasObservedActivePlaybackRef.current) {
      return;
    }

    backgroundExecutionActiveRef.current = false;
    void mocks.stopBackgroundExecution({
      source: "playback-controller",
      reason: isPaused ? "pause" : "stop",
      context: { trackInstanceId },
    });
  }, [backgroundExecutionEnabled, isPaused, isPlaying, trackInstanceId]);

  useEffect(
    () => () => {
      if (!backgroundExecutionActiveRef.current) return;
      const latestPlaybackState = playbackStateRef.current;
      if ((latestPlaybackState.isPlaying && !latestPlaybackState.isPaused) || !hasObservedActivePlaybackRef.current) {
        return;
      }
      backgroundExecutionActiveRef.current = false;
      void mocks.stopBackgroundExecution({
        source: "playback-controller",
        reason: "cleanup",
        context: { trackInstanceId },
      });
    },
    [trackInstanceId],
  );

  return null;
}

describe("PlayFilesPage background execution lifecycle", () => {
  beforeEach(() => {
    mocks.startBackgroundExecution.mockClear();
    mocks.stopBackgroundExecution.mockClear();
    mocks.isBackgroundExecutionActive.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adopts an already-active session on remount instead of calling start again", async () => {
    let managerActive = false;
    mocks.isBackgroundExecutionActive.mockImplementation(() => managerActive);
    mocks.startBackgroundExecution.mockImplementation(async () => {
      managerActive = true;
    });
    mocks.stopBackgroundExecution.mockImplementation(async () => {
      managerActive = false;
    });

    const firstMount = render(
      <Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={false} trackInstanceId={1} />,
    );

    await waitFor(() => expect(mocks.startBackgroundExecution).toHaveBeenCalledTimes(1));

    act(() => {
      firstMount.unmount();
    });

    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(managerActive).toBe(true);

    render(<Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={false} trackInstanceId={1} />);

    expect(mocks.startBackgroundExecution).toHaveBeenCalledTimes(1);
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(managerActive).toBe(true);
  });

  it("a transient instance that only adopted the active session never releases the live wake lock (BUG-040)", async () => {
    // The manager already holds the wake lock for a live playing session.
    let managerActive = true;
    mocks.isBackgroundExecutionActive.mockImplementation(() => managerActive);
    mocks.startBackgroundExecution.mockImplementation(async () => {
      managerActive = true;
    });
    mocks.stopBackgroundExecution.mockImplementation(async () => {
      managerActive = false;
    });

    // A fresh/transient Play instance mounts during a tab transition with
    // isPlaying=false (its async session restore has not run yet). It adopts the
    // active session but must neither stop on mount nor release on unmount.
    const transient = render(
      <Harness backgroundExecutionEnabled={true} isPlaying={false} isPaused={false} trackInstanceId={2} />,
    );

    await waitFor(() => expect(mocks.isBackgroundExecutionActive).toHaveBeenCalled());
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(managerActive).toBe(true);

    act(() => {
      transient.unmount();
    });

    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(mocks.startBackgroundExecution).not.toHaveBeenCalled();
    expect(managerActive).toBe(true);
  });

  it("an instance that genuinely played still releases on stop", async () => {
    let managerActive = false;
    mocks.isBackgroundExecutionActive.mockImplementation(() => managerActive);
    mocks.startBackgroundExecution.mockImplementation(async () => {
      managerActive = true;
    });
    mocks.stopBackgroundExecution.mockImplementation(async () => {
      managerActive = false;
    });

    const view = render(
      <Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={false} trackInstanceId={3} />,
    );
    await waitFor(() => expect(mocks.startBackgroundExecution).toHaveBeenCalledTimes(1));

    // User stops playback on the same instance → wake lock must be released.
    view.rerender(<Harness backgroundExecutionEnabled={true} isPlaying={false} isPaused={false} trackInstanceId={3} />);

    await waitFor(() => expect(mocks.stopBackgroundExecution).toHaveBeenCalledTimes(1));
    expect(managerActive).toBe(false);
  });
});

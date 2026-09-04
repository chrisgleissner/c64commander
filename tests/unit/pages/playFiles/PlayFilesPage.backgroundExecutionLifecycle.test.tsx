import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBackgroundExecutionAction } from "@/pages/playFiles/backgroundExecutionPolicy";

const mocks = vi.hoisted(() => ({
  startBackgroundExecution: vi.fn(async () => undefined),
  stopBackgroundExecution: vi.fn(async () => undefined),
  setBackgroundExecutionPaused: vi.fn(async () => undefined),
  isBackgroundExecutionActive: vi.fn(() => false),
}));

vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  isBackgroundExecutionActive: mocks.isBackgroundExecutionActive,
  startBackgroundExecution: mocks.startBackgroundExecution,
  stopBackgroundExecution: mocks.stopBackgroundExecution,
  setBackgroundExecutionPaused: mocks.setBackgroundExecutionPaused,
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
    // The branch ordering itself is production code (resolveBackgroundExecutionAction); this
    // harness only supplies the refs and side effects the real page owns.
    const action = resolveBackgroundExecutionAction({
      backgroundExecutionEnabled,
      backgroundExecutionActive: backgroundExecutionActiveRef.current,
      isPlaying,
      isPaused,
    });
    if (action === "start") {
      backgroundExecutionActiveRef.current = true;
      void mocks.startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
        context: { trackInstanceId },
      });
      return;
    }

    if (action === "publish-paused" || action === "publish-playing") {
      const paused = action === "publish-paused";
      void mocks.setBackgroundExecutionPaused(paused, {
        source: "playback-controller",
        reason: paused ? "pause" : "resume",
        context: { trackInstanceId },
      });
      return;
    }

    if (action !== "stop") {
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
      reason: "stop",
      context: { trackInstanceId },
    });
  }, [backgroundExecutionEnabled, isPaused, isPlaying, trackInstanceId]);

  useEffect(
    () => () => {
      if (!backgroundExecutionActiveRef.current) return;
      const latestPlaybackState = playbackStateRef.current;
      if (latestPlaybackState.isPlaying || !hasObservedActivePlaybackRef.current) {
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
    mocks.setBackgroundExecutionPaused.mockClear();
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

  it("HARD27-007: a pause keeps the session and only publishes the paused state", async () => {
    let managerActive = false;
    mocks.isBackgroundExecutionActive.mockImplementation(() => managerActive);
    mocks.startBackgroundExecution.mockImplementation(async () => {
      managerActive = true;
    });
    mocks.stopBackgroundExecution.mockImplementation(async () => {
      managerActive = false;
    });

    const view = render(
      <Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={false} trackInstanceId={4} />,
    );
    await waitFor(() => expect(mocks.startBackgroundExecution).toHaveBeenCalledTimes(1));

    view.rerender(<Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={true} trackInstanceId={4} />);

    await waitFor(() => expect(mocks.setBackgroundExecutionPaused).toHaveBeenCalledTimes(1));
    expect(mocks.setBackgroundExecutionPaused).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ reason: "pause" }),
    );
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(managerActive).toBe(true);

    // Tabbing away while paused must not be what kills the headset controls; the service's own
    // grace period bounds how long the paused session survives.
    act(() => {
      view.unmount();
    });
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(managerActive).toBe(true);
  });

  it("HARD27-007: resuming publishes the playing state without a second start", async () => {
    let managerActive = false;
    mocks.isBackgroundExecutionActive.mockImplementation(() => managerActive);
    mocks.startBackgroundExecution.mockImplementation(async () => {
      managerActive = true;
    });

    const view = render(
      <Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={false} trackInstanceId={5} />,
    );
    await waitFor(() => expect(mocks.startBackgroundExecution).toHaveBeenCalledTimes(1));

    view.rerender(<Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={true} trackInstanceId={5} />);
    await waitFor(() => expect(mocks.setBackgroundExecutionPaused).toHaveBeenCalledTimes(1));

    view.rerender(<Harness backgroundExecutionEnabled={true} isPlaying={true} isPaused={false} trackInstanceId={5} />);

    await waitFor(() => expect(mocks.setBackgroundExecutionPaused).toHaveBeenCalledTimes(2));
    expect(mocks.setBackgroundExecutionPaused).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ reason: "resume" }),
    );
    expect(mocks.startBackgroundExecution).toHaveBeenCalledTimes(1);
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

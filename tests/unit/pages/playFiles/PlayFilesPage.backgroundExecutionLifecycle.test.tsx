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

  useEffect(() => {
    playbackStateRef.current = { isPlaying, isPaused };
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
      if (latestPlaybackState.isPlaying && !latestPlaybackState.isPaused) {
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
});

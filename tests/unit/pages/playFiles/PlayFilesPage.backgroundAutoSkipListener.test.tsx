import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

type BackgroundEvent = { dueAtMs: number };
type ListenerHandle = { remove: () => Promise<void> };
type Listener = (event: BackgroundEvent) => void;
type Guard = {
  trackInstanceId: number;
  dueAtMs: number;
  autoFired: boolean;
  userCancelled: boolean;
};

type Controls = {
  setCurrentIndex: (value: number | ((current: number) => number)) => void;
  setIsPlaying: (value: boolean | ((current: boolean) => boolean)) => void;
  setIsPaused: (value: boolean | ((current: boolean) => boolean)) => void;
};

const testFilePath = fileURLToPath(import.meta.url);
const playFilesPagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const playFilesPageSource = readFileSync(playFilesPagePath, "utf8");

const renderHarness = () => {
  const addListener = vi.fn<(_: string, listener: Listener) => Promise<ListenerHandle>>();
  const removeListener = vi.fn().mockResolvedValue(undefined);
  const handleNext = vi.fn(async () => {});
  const syncPlaybackTimeline = vi.fn();
  let listener: Listener | null = null;
  let controls: Controls | null = null;

  const onBackgroundAutoSkipDue = async (nextListener: Listener) => {
    listener = nextListener;
    return await addListener("backgroundAutoSkipDue", nextListener);
  };

  function Harness() {
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const handleNextRef = useRef(async (_reason: "auto", _expectedTrackInstanceId: number) => {
      handleNext();
      setCurrentIndex((current) => current + 1);
    });
    const playbackStateRef = useRef({ isPlaying, isPaused });
    const syncPlaybackTimelineRef = useRef((_options?: { allowAutoAdvance?: boolean }) => {
      syncPlaybackTimeline();
    });
    const autoAdvanceGuardRef = useRef<Guard | null>(null);
    const queueBackgroundDueAtUpdateRef = useRef(async (_dueAtMs: number | null) => {});
    const [, setAutoAdvanceDueAtMs] = useState<number | null>(null);

    controls = { setCurrentIndex, setIsPlaying, setIsPaused };
    playbackStateRef.current = { isPlaying, isPaused };
    syncPlaybackTimelineRef.current = (_options?: { allowAutoAdvance?: boolean }) => {
      syncPlaybackTimeline();
    };
    autoAdvanceGuardRef.current =
      isPlaying && !isPaused && currentIndex >= 0
        ? {
            trackInstanceId: currentIndex + 1,
            dueAtMs: 2_000 + currentIndex,
            autoFired: false,
            userCancelled: false,
          }
        : null;

    useEffect(() => {
      let cancelled = false;
      let handle: ListenerHandle | null = null;

      const registerBackgroundAutoSkipListener = async () => {
        const nextHandle = await onBackgroundAutoSkipDue((event) => {
          if (cancelled) return;
          syncPlaybackTimelineRef.current({ allowAutoAdvance: false });
          const guard = autoAdvanceGuardRef.current;
          const playbackState = playbackStateRef.current;
          if (!guard || !playbackState.isPlaying || playbackState.isPaused) return;
          if (event.dueAtMs !== guard.dueAtMs) return;
          const expectedTrackInstanceId = guard.trackInstanceId;
          void (async () => {
            await handleNextRef.current("auto", expectedTrackInstanceId);
            if (cancelled) return;
            const nextGuard = autoAdvanceGuardRef.current;
            if (!nextGuard || nextGuard.trackInstanceId === expectedTrackInstanceId) {
              setAutoAdvanceDueAtMs(null);
              await queueBackgroundDueAtUpdateRef.current(null);
              return;
            }
            setAutoAdvanceDueAtMs(nextGuard.dueAtMs);
            await queueBackgroundDueAtUpdateRef.current(nextGuard.dueAtMs);
          })();
        });
        if (cancelled) {
          await nextHandle.remove();
          return;
        }
        handle = nextHandle;
      };

      void registerBackgroundAutoSkipListener();

      return () => {
        cancelled = true;
        if (handle) {
          void handle.remove();
        }
      };
    }, []);

    return null;
  }

  addListener.mockResolvedValue({ remove: removeListener });
  const view = render(<Harness />);

  return {
    addListener,
    removeListener,
    handleNext,
    syncPlaybackTimeline,
    fire: (event: BackgroundEvent) => listener?.(event),
    controls: () => controls,
    unmount: () => view.unmount(),
  };
};

describe("PlayFilesPage background auto-skip listener", () => {
  it("keeps the page wired to a once-only listener effect with stable ref dependencies", () => {
    expect(playFilesPageSource).toContain("const registerBackgroundAutoSkipListener = async () => {");
    expect(playFilesPageSource).toContain("const nextHandle = await onBackgroundAutoSkipDue((event) => {");
    expect(playFilesPageSource).toContain("const handleNextRef = useRef(handleNext);");
    expect(playFilesPageSource).toContain("const playbackStateRef = useRef({ isPlaying, isPaused });");
    expect(playFilesPageSource).toContain("const syncPlaybackTimelineRef = useRef(syncPlaybackTimeline);");
    expect(playFilesPageSource).toContain(
      "}, [autoAdvanceGuardRef, handleNextRef, playbackStateRef, queueBackgroundDueAtUpdateRef, syncPlaybackTimelineRef]);",
    );
  });

  it("registers the listener once, removes it on unmount, and auto-advances exactly once through refs", async () => {
    const harness = renderHarness();

    await waitFor(() => expect(harness.addListener).toHaveBeenCalledTimes(1));

    act(() => {
      harness.controls()?.setCurrentIndex(0);
      harness.controls()?.setIsPlaying(true);
      harness.controls()?.setIsPaused(false);
    });

    act(() => {
      harness.controls()?.setIsPaused(true);
    });

    act(() => {
      harness.controls()?.setIsPaused(false);
    });

    expect(harness.addListener).toHaveBeenCalledTimes(1);

    act(() => {
      harness.fire({ dueAtMs: 2_000 });
    });

    await waitFor(() => expect(harness.handleNext).toHaveBeenCalledTimes(1));
    expect(harness.syncPlaybackTimeline).toHaveBeenCalledTimes(1);

    act(() => {
      harness.fire({ dueAtMs: 2_000 });
    });

    expect(harness.handleNext).toHaveBeenCalledTimes(1);
    expect(harness.removeListener).not.toHaveBeenCalled();

    harness.unmount();

    await waitFor(() => expect(harness.removeListener).toHaveBeenCalledTimes(1));
  });
});

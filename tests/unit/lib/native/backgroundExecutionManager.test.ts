import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  setPlaybackState: vi.fn(async () => undefined),
  setNowPlaying: vi.fn(async () => undefined),
  heartbeat: vi.fn(async () => undefined),
  getPlatform: vi.fn(() => "android"),
  addLog: vi.fn(),
  getLifecycleState: vi.fn(() => "active"),
  classifyError: vi.fn(() => ({
    failureClass: "plugin-failure",
    category: "integration",
  })),
}));

vi.mock("@/lib/native/backgroundExecution", () => ({
  BackgroundExecution: {
    start: mocks.start,
    stop: mocks.stop,
    setPlaybackState: mocks.setPlaybackState,
    setNowPlaying: mocks.setNowPlaying,
    heartbeat: mocks.heartbeat,
  },
}));

vi.mock("@/lib/native/platform", () => ({ getPlatform: mocks.getPlatform }));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
}));

const keepAlive = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/native/webViewKeepAlive", () => ({
  startWebViewKeepAlive: keepAlive.start,
  stopWebViewKeepAlive: keepAlive.stop,
}));

vi.mock("@/lib/appLifecycle", () => ({
  getLifecycleState: mocks.getLifecycleState,
}));

vi.mock("@/lib/tracing/failureTaxonomy", () => ({
  classifyError: mocks.classifyError,
}));

import {
  BACKGROUND_HEARTBEAT_INTERVAL_MS,
  isBackgroundExecutionActive,
  resetBackgroundExecutionState,
  setBackgroundExecutionNowPlaying,
  setBackgroundExecutionPaused,
  startBackgroundExecution,
  stopBackgroundExecution,
} from "@/lib/native/backgroundExecutionManager";
import { subscribePlaybackActivity } from "@/lib/playback/playbackActivitySignal";

describe("backgroundExecutionManager", () => {
  beforeEach(() => {
    resetBackgroundExecutionState();
    mocks.start.mockReset();
    mocks.stop.mockReset();
    mocks.setPlaybackState.mockReset();
    mocks.setNowPlaying.mockReset();
    mocks.addLog.mockReset();
    mocks.heartbeat.mockReset();
    mocks.heartbeat.mockResolvedValue(undefined);
    mocks.getPlatform.mockReturnValue("android");
    keepAlive.start.mockReset();
    keepAlive.stop.mockReset();
    mocks.getLifecycleState.mockReturnValue("active");
    mocks.classifyError.mockReturnValue({
      failureClass: "plugin-failure",
      category: "integration",
    });
  });

  afterEach(() => {
    resetBackgroundExecutionState();
  });

  it("tells playback listeners when the last session stops, as it does when a playlist ends by itself", async () => {
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    const listener = vi.fn();
    const unsubscribe = subscribePlaybackActivity(listener);
    try {
      await startBackgroundExecution({});
      await stopBackgroundExecution({});
      expect(isBackgroundExecutionActive()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("keeps the page free to sleep when playback was paused while the start was still in flight", async () => {
    let finishStart: () => void = () => undefined;
    mocks.start.mockReturnValue(new Promise<void>((resolve) => (finishStart = resolve)));
    mocks.setPlaybackState.mockResolvedValue(undefined);
    const starting = startBackgroundExecution({});
    await setBackgroundExecutionPaused(true, {});
    keepAlive.start.mockClear();
    finishStart();
    await starting;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keepAlive.start).not.toHaveBeenCalled();
  });

  it("HARD27-040: publishes the tune a start was issued for, which was named before the session existed", async () => {
    // The page names the track in the commit before the one that starts playback, so a manager
    // that only published while a session was live would leave the lock screen naming the app.
    await setBackgroundExecutionNowPlaying(
      { title: "Nightshift", artist: "Jeroen Tel", durationMs: 195_000 },
      {
        source: "test",
      },
    );
    expect(mocks.setNowPlaying).not.toHaveBeenCalled();

    await startBackgroundExecution({ source: "test" });

    expect(mocks.setNowPlaying).toHaveBeenCalledWith({
      title: "Nightshift",
      artist: "Jeroen Tel",
      durationMs: 195_000,
    });
  });

  it("HARD27-040: republishes after a start, because an update issued while the start was in flight never reached the service", async () => {
    // The page publishes in the same commit that starts playback, so the update regularly reaches
    // the native side before the foreground service exists, and the native side drops it rather
    // than starting a service metadata alone did not justify. Deduping the post-start publish
    // against that dropped attempt left the lock screen naming the app instead of the tune.
    let releaseStart: (() => void) | null = null;
    mocks.start.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releaseStart = () => resolve(undefined);
        }),
    );
    const startPromise = startBackgroundExecution({ source: "test" });
    await Promise.resolve();

    const info = { title: "Nightshift", artist: "Ari Yliaho (Agemixer)", durationMs: 155_000 };
    await setBackgroundExecutionNowPlaying(info, { source: "test" });
    expect(mocks.setNowPlaying).toHaveBeenCalledTimes(1);

    releaseStart!();
    await startPromise;

    expect(mocks.setNowPlaying).toHaveBeenCalledTimes(2);
    expect(mocks.setNowPlaying).toHaveBeenLastCalledWith(info);
  });

  it("HARD27-040: publishes each new track once and skips an unchanged one", async () => {
    await startBackgroundExecution({ source: "test" });
    await setBackgroundExecutionNowPlaying(
      { title: "Nightshift", artist: "Jeroen Tel", durationMs: 195_000 },
      {
        source: "test",
      },
    );
    await setBackgroundExecutionNowPlaying(
      { title: "Nightshift", artist: "Jeroen Tel", durationMs: 195_000 },
      {
        source: "test",
      },
    );
    expect(mocks.setNowPlaying).toHaveBeenCalledTimes(1);

    await setBackgroundExecutionNowPlaying(
      { title: "Comic Bakery", artist: "Martin Galway", durationMs: 240_000 },
      {
        source: "test",
      },
    );
    expect(mocks.setNowPlaying).toHaveBeenLastCalledWith({
      title: "Comic Bakery",
      artist: "Martin Galway",
      durationMs: 240_000,
    });
    expect(mocks.setNowPlaying).toHaveBeenCalledTimes(2);
  });

  it("HARD27-040: a failed metadata publish is logged, thrown and still retryable", async () => {
    await startBackgroundExecution({ source: "test" });
    mocks.setNowPlaying.mockRejectedValueOnce(new Error("plugin-failed"));

    const info = { title: "Nightshift", artist: "Jeroen Tel", durationMs: 195_000 };
    await expect(setBackgroundExecutionNowPlaying(info, { source: "test" })).rejects.toThrow(
      "Background execution now-playing failed: plugin-failed",
    );
    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution now-playing update failed",
      expect.objectContaining({ source: "test" }),
    );

    // The dedupe must not have swallowed the tune that never reached the session.
    await setBackgroundExecutionNowPlaying(info, { source: "test" });
    expect(mocks.setNowPlaying).toHaveBeenCalledTimes(2);
  });

  it("HARD27-040: a start whose metadata publish fails still starts background execution", async () => {
    await setBackgroundExecutionNowPlaying(
      { title: "Nightshift", artist: null, durationMs: null },
      {
        source: "test",
      },
    );
    mocks.setNowPlaying.mockRejectedValueOnce(new Error("plugin-failed"));

    await expect(startBackgroundExecution({ source: "test" })).resolves.toBeUndefined();
    expect(isBackgroundExecutionActive()).toBe(true);
  });

  it("HARD27-040: stopping forgets the tune, so the next session republishes it", async () => {
    await startBackgroundExecution({ source: "test" });
    const info = { title: "Nightshift", artist: "Jeroen Tel", durationMs: 195_000 };
    await setBackgroundExecutionNowPlaying(info, { source: "test" });
    await stopBackgroundExecution({ source: "test" });

    await startBackgroundExecution({ source: "test" });
    expect(mocks.setNowPlaying).toHaveBeenCalledTimes(1);

    await setBackgroundExecutionNowPlaying(info, { source: "test" });
    expect(mocks.setNowPlaying).toHaveBeenCalledTimes(2);
  });

  it("HARD27-007: publishes the paused state of a live session and stays silent without one", async () => {
    await setBackgroundExecutionPaused(true, { source: "test" });
    expect(mocks.setPlaybackState).not.toHaveBeenCalled();

    await startBackgroundExecution({ source: "test" });
    await setBackgroundExecutionPaused(true, { source: "test" });
    expect(mocks.setPlaybackState).toHaveBeenCalledWith({ paused: true });

    await setBackgroundExecutionPaused(false, { source: "test" });
    expect(mocks.setPlaybackState).toHaveBeenLastCalledWith({ paused: false });
    // A pause must never unbalance the reference count; only stop() does.
    expect(isBackgroundExecutionActive()).toBe(true);
  });

  // The page froze a minute after the screen went off, so a tune playing on the phone fell silent.
  it("keeps the page awake while a session plays, and lets it sleep while paused or stopped", async () => {
    mocks.start.mockRejectedValueOnce(new Error("plugin-failed"));
    await expect(startBackgroundExecution({ source: "test" })).rejects.toThrow();
    await import("@/lib/native/webViewKeepAlive");
    expect(keepAlive.start).not.toHaveBeenCalled();

    await startBackgroundExecution({ source: "test" });
    await vi.waitFor(() => expect(keepAlive.start).toHaveBeenCalledTimes(1));

    await setBackgroundExecutionPaused(true, { source: "test" });
    await vi.waitFor(() => expect(keepAlive.stop).toHaveBeenCalledTimes(1));
    await setBackgroundExecutionPaused(false, { source: "test" });
    await vi.waitFor(() => expect(keepAlive.start).toHaveBeenCalledTimes(2));

    await stopBackgroundExecution({ source: "test" });
    await vi.waitFor(() => expect(keepAlive.stop).toHaveBeenCalledTimes(2));
  });

  // The module loads after the calls that want it: a stop issued before an earlier start has loaded still wins.
  it("leaves the page free to sleep when a stop comes before the keep-awake module has loaded", async () => {
    await startBackgroundExecution({ source: "test" });
    await stopBackgroundExecution({ source: "test" });

    await vi.waitFor(() => expect(keepAlive.stop).toHaveBeenCalled());
    expect(keepAlive.start).not.toHaveBeenCalled();
  });

  it("HARD27-007: logs and throws when the paused-state update fails", async () => {
    await startBackgroundExecution({ source: "test" });
    mocks.setPlaybackState.mockRejectedValueOnce(new Error("plugin-failed"));

    await expect(setBackgroundExecutionPaused(true, { source: "test" })).rejects.toThrow(
      "Background execution playback-state failed: plugin-failed",
    );
    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution playback state update failed",
      expect.objectContaining({ source: "test" }),
    );

    // A failed publish must stay retryable rather than being swallowed as already-published.
    await setBackgroundExecutionPaused(true, { source: "test" });
    expect(mocks.setPlaybackState).toHaveBeenLastCalledWith({ paused: true });
  });

  it("logs error and throws when background start fails", async () => {
    mocks.start.mockRejectedValueOnce(new Error("start-failed"));

    await expect(
      startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
      }),
    ).rejects.toThrow("Background execution start failed: start-failed");

    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution start failed",
      expect.objectContaining({
        source: "playback-controller",
        reason: "play",
        lifecycleState: "active",
        failureClass: "plugin-failure",
        failureCategory: "integration",
        error: "start-failed",
      }),
    );
  });

  it("logs error and throws when background stop fails", async () => {
    mocks.stop.mockRejectedValueOnce(new Error("stop-failed"));

    await startBackgroundExecution({
      source: "playback-controller",
      reason: "play",
    });
    await expect(
      stopBackgroundExecution({
        source: "playback-controller",
        reason: "pause",
      }),
    ).rejects.toThrow("Background execution stop failed: stop-failed");

    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution stop failed",
      expect.objectContaining({
        source: "playback-controller",
        reason: "pause",
        lifecycleState: "active",
        failureClass: "plugin-failure",
        failureCategory: "integration",
        error: "stop-failed",
      }),
    );
  });

  it("uses reference counting to avoid duplicate native starts and stops", async () => {
    await startBackgroundExecution({
      source: "playback-controller",
      reason: "play",
    });
    await startBackgroundExecution({
      source: "playback-controller",
      reason: "play",
    });
    expect(mocks.start).toHaveBeenCalledTimes(1);

    await stopBackgroundExecution({
      source: "playback-controller",
      reason: "pause",
    });
    expect(mocks.stop).not.toHaveBeenCalled();

    await stopBackgroundExecution({
      source: "playback-controller",
      reason: "stop",
    });
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("reports an outstanding native session via isBackgroundExecutionActive", async () => {
    expect(isBackgroundExecutionActive()).toBe(false);

    await startBackgroundExecution({ source: "playback-controller", reason: "play" });
    expect(isBackgroundExecutionActive()).toBe(true);

    await stopBackgroundExecution({ source: "playback-controller", reason: "stop" });
    expect(isBackgroundExecutionActive()).toBe(false);
  });

  it("normalizes non-Error failures when start rejects", async () => {
    mocks.start.mockRejectedValueOnce("string-failure");

    await expect(
      startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
      }),
    ).rejects.toThrow("Background execution start failed: string-failure");

    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "Background execution start failed",
      expect.objectContaining({
        error: "string-failure",
      }),
    );
  });

  describe("heartbeat for the native liveness check (issue 504)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mocks.start.mockResolvedValue(undefined);
      mocks.stop.mockResolvedValue(undefined);
      mocks.setPlaybackState.mockResolvedValue(undefined);
    });

    afterEach(() => {
      resetBackgroundExecutionState();
      vi.useRealTimers();
    });

    it("beats at once on start and then every interval while the session plays", async () => {
      await startBackgroundExecution({ source: "test" });
      expect(mocks.heartbeat).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(BACKGROUND_HEARTBEAT_INTERVAL_MS * 3);

      expect(mocks.heartbeat).toHaveBeenCalledTimes(4);
    });

    it("beats well inside the native timeout of 15 seconds", () => {
      expect(BACKGROUND_HEARTBEAT_INTERVAL_MS * 2).toBeLessThan(15_000);
    });

    it("stops beating while paused and resumes beating when playback resumes", async () => {
      await startBackgroundExecution({ source: "test" });
      await setBackgroundExecutionPaused(true, { source: "test" });
      mocks.heartbeat.mockClear();

      await vi.advanceTimersByTimeAsync(BACKGROUND_HEARTBEAT_INTERVAL_MS * 3);
      expect(mocks.heartbeat).not.toHaveBeenCalled();

      await setBackgroundExecutionPaused(false, { source: "test" });
      expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(BACKGROUND_HEARTBEAT_INTERVAL_MS);
      expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
    });

    it("stops beating when the session stops", async () => {
      await startBackgroundExecution({ source: "test" });
      await stopBackgroundExecution({ source: "test" });
      mocks.heartbeat.mockClear();

      await vi.advanceTimersByTimeAsync(BACKGROUND_HEARTBEAT_INTERVAL_MS * 3);

      expect(mocks.heartbeat).not.toHaveBeenCalled();
    });

    it("does not beat off Android, where the plugin has no such method", async () => {
      mocks.getPlatform.mockReturnValue("ios");

      await startBackgroundExecution({ source: "test" });
      await vi.advanceTimersByTimeAsync(BACKGROUND_HEARTBEAT_INTERVAL_MS * 3);

      expect(mocks.heartbeat).not.toHaveBeenCalled();
    });

    it("logs a failing heartbeat once instead of on every beat", async () => {
      mocks.heartbeat.mockRejectedValue(new Error("bridge gone"));

      await startBackgroundExecution({ source: "test" });
      await vi.advanceTimersByTimeAsync(BACKGROUND_HEARTBEAT_INTERVAL_MS * 3);

      const warnings = mocks.addLog.mock.calls.filter(([level, message]) => {
        return level === "warn" && message === "Background execution heartbeat failed";
      });
      expect(warnings).toHaveLength(1);
    });
  });
});

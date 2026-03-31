import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundExecutionWeb } from "@/lib/native/backgroundExecution.web";

const addLogMock = vi.fn();

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

describe("BackgroundExecutionWeb", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    addLogMock.mockReset();
    Object.defineProperty(window.navigator, "wakeLock", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs when wake lock is unavailable", async () => {
    const plugin = new BackgroundExecutionWeb();
    await plugin.start();
    expect(addLogMock).toHaveBeenCalledWith("info", "Background execution wake lock unavailable on web", {
      source: "background-execution-web",
    });
  });

  it("acquires and releases wake lock when available", async () => {
    const releaseMock = vi.fn(async () => {});
    const requestMock = vi.fn(async () => ({ release: releaseMock }));
    Object.defineProperty(window.navigator, "wakeLock", {
      configurable: true,
      value: { request: requestMock },
    });

    const plugin = new BackgroundExecutionWeb();
    await plugin.start();
    await plugin.stop();

    expect(requestMock).toHaveBeenCalledWith("screen");
    expect(releaseMock).toHaveBeenCalled();
  });

  it("logs wake lock request failures", async () => {
    Object.defineProperty(window.navigator, "wakeLock", {
      configurable: true,
      value: {
        request: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });

    const plugin = new BackgroundExecutionWeb();
    await plugin.start();

    expect(addLogMock).toHaveBeenCalledWith("warn", "Web wake lock request failed", {
      source: "background-execution-web",
      error: "denied",
    });
  });

  it("logs wake lock release failures", async () => {
    const releaseMock = vi.fn(async () => {
      throw new Error("release-failed");
    });
    Object.defineProperty(window.navigator, "wakeLock", {
      configurable: true,
      value: { request: vi.fn(async () => ({ release: releaseMock })) },
    });

    const plugin = new BackgroundExecutionWeb();
    await plugin.start();
    await plugin.stop();

    expect(addLogMock).toHaveBeenCalledWith("warn", "Web wake lock release failed", {
      source: "background-execution-web",
      error: "release-failed",
    });
  });

  it("fires backgroundAutoSkipDue event at due time", async () => {
    const plugin = new BackgroundExecutionWeb();
    const listener = vi.fn();
    await plugin.addListener("backgroundAutoSkipDue", listener);

    await plugin.setDueAtMs({ dueAtMs: Date.now() + 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].dueAtMs).toBeTypeOf("number");
    expect(listener.mock.calls[0][0].firedAtMs).toBeTypeOf("number");
  });

  it("removes listeners cleanly", async () => {
    const plugin = new BackgroundExecutionWeb();
    const listener = vi.fn();
    const handle = await plugin.addListener("backgroundAutoSkipDue", listener);

    await handle.remove();
    await plugin.setDueAtMs({ dueAtMs: Date.now() + 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports clearing due timer with null dueAtMs", async () => {
    const plugin = new BackgroundExecutionWeb();
    const listener = vi.fn();
    await plugin.addListener("backgroundAutoSkipDue", listener);
    await plugin.setDueAtMs({ dueAtMs: Date.now() + 1_000 });
    await plugin.setDueAtMs({ dueAtMs: null });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("logs unsupported event names on listener registration", async () => {
    const plugin = new BackgroundExecutionWeb();
    const listener = vi.fn();
    await plugin.addListener("backgroundAutoSkipDue" as never, listener);
    await plugin.addListener("unsupported-event" as never, listener);

    expect(addLogMock).toHaveBeenCalledWith("warn", "Unsupported web background execution listener event", {
      source: "background-execution-web",
      eventName: "unsupported-event",
    });
  });

  it("clears active due timer when stop is called while a timer is pending", async () => {
    const plugin = new BackgroundExecutionWeb();
    const listener = vi.fn();
    await plugin.addListener("backgroundAutoSkipDue", listener);
    await plugin.setDueAtMs({ dueAtMs: Date.now() + 5_000 });
    await plugin.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("sets wakeLock to null and returns early when wakeLock has no release method", async () => {
    const requestMock = vi.fn(async () => ({ /* no release */ } as unknown as WakeLockSentinel));
    Object.defineProperty(window.navigator, "wakeLock", {
      configurable: true,
      value: { request: requestMock },
    });
    const plugin = new BackgroundExecutionWeb();
    await plugin.start();
    await plugin.stop();
    expect(requestMock).toHaveBeenCalledWith("screen");
    // stop() should not throw when wakeLock.release is absent
  });

  it("logs a warning when a backgroundAutoSkipDue listener throws", async () => {
    const plugin = new BackgroundExecutionWeb();
    const throwingListener = vi.fn(() => {
      throw new Error("listener-boom");
    });
    await plugin.addListener("backgroundAutoSkipDue", throwingListener);
    await plugin.setDueAtMs({ dueAtMs: Date.now() + 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(addLogMock).toHaveBeenCalledWith("warn", "Web background due listener failed", {
      source: "background-execution-web",
      error: "listener-boom",
    });
  });
});

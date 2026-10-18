import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import {
  STREAM_RECOVERY_BACKOFF_MS,
  STREAM_RECOVERY_STABLE_MS,
  StreamLossRecovery,
  StreamLossRestarter,
  type StreamLossRestarterHooks,
} from "@/lib/streams/streamLossRecovery";

describe("StreamLossRecovery", () => {
  it("allows exactly one restart per backoff entry, then gives up", () => {
    const recovery = new StreamLossRecovery();
    const delays = STREAM_RECOVERY_BACKOFF_MS.map(() => recovery.noteLost(0));
    expect(delays).toEqual([...STREAM_RECOVERY_BACKOFF_MS]);
    expect(recovery.noteLost(0)).toBeNull();
  });

  it("does not refill the attempts when the restarted stream was live for less than the stable period", () => {
    const recovery = new StreamLossRecovery();
    STREAM_RECOVERY_BACKOFF_MS.forEach(() => recovery.noteLost(0));
    expect(recovery.noteLost(STREAM_RECOVERY_STABLE_MS - 1)).toBeNull();
  });

  it("refills the attempts when the stream was live for the stable period", () => {
    const recovery = new StreamLossRecovery();
    STREAM_RECOVERY_BACKOFF_MS.forEach(() => recovery.noteLost(0));
    expect(recovery.noteLost(STREAM_RECOVERY_STABLE_MS)).toBe(STREAM_RECOVERY_BACKOFF_MS[0]);
  });

  it("starts a fresh episode after reset", () => {
    const recovery = new StreamLossRecovery();
    STREAM_RECOVERY_BACKOFF_MS.forEach(() => recovery.noteLost(0));
    recovery.reset();
    expect(recovery.noteLost(0)).toBe(STREAM_RECOVERY_BACKOFF_MS[0]);
  });
});

describe("StreamLossRestarter", () => {
  let hooks: StreamLossRestarterHooks & {
    restart: ReturnType<typeof vi.fn>;
    giveUp: ReturnType<typeof vi.fn>;
    deviceAnswers: ReturnType<typeof vi.fn>;
  };
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    hooks = {
      isWanted: () => true,
      isLost: () => true,
      deviceAnswers: vi.fn(async () => true),
      restart: vi.fn(async () => undefined),
      giveUp: vi.fn(),
      isPageHidden: () => hidden,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restarts after the first backoff delay when Watch is wanted and the device answers", async () => {
    const restarter = new StreamLossRestarter(hooks);
    expect(restarter.onLost(5000)).toBe(true);
    expect(hooks.restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_BACKOFF_MS[0]);
    expect(hooks.restart).toHaveBeenCalledTimes(1);
  });

  it("does not restart, and reports no restart, when Watch is no longer wanted", async () => {
    const restarter = new StreamLossRestarter({ ...hooks, isWanted: () => false });
    expect(restarter.onLost(5000)).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(hooks.restart).not.toHaveBeenCalled();
  });

  it("restarts at most as many times as the backoff has entries while the stream keeps dying", async () => {
    const restarter = new StreamLossRestarter(hooks);
    const scheduled = [restarter.onLost(1000), restarter.onLost(1000), restarter.onLost(1000)];
    expect(scheduled).toEqual([true, true, false]);
  });

  it("gives up without restarting when the device does not answer REST", async () => {
    hooks.deviceAnswers.mockResolvedValue(false);
    const restarter = new StreamLossRestarter(hooks);
    restarter.onLost(5000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_BACKOFF_MS[0]);
    expect(hooks.restart).not.toHaveBeenCalled();
    expect(hooks.giveUp).toHaveBeenCalledTimes(1);
  });

  it("gives up when the restart itself throws", async () => {
    hooks.restart.mockRejectedValue(new Error("boom"));
    const restarter = new StreamLossRestarter(hooks);
    restarter.onLost(5000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_BACKOFF_MS[0]);
    expect(hooks.giveUp).toHaveBeenCalledTimes(1);
  });

  it("does not touch the device when the video came back before the restart was due", async () => {
    let lost = true;
    const restarter = new StreamLossRestarter({ ...hooks, isLost: () => lost });
    restarter.onLost(5000);
    lost = false;

    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_BACKOFF_MS[0]);

    expect(hooks.deviceAnswers).not.toHaveBeenCalled();
    expect(hooks.restart).not.toHaveBeenCalled();
  });

  it("does not restart when Watch was stopped while the device was being asked", async () => {
    let wanted = true;
    hooks.deviceAnswers.mockImplementation(async () => {
      wanted = false;
      return true;
    });
    const restarter = new StreamLossRestarter({ ...hooks, isWanted: () => wanted });
    restarter.onLost(5000);

    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_BACKOFF_MS[0]);

    expect(hooks.deviceAnswers).toHaveBeenCalledTimes(1);
    expect(hooks.restart).not.toHaveBeenCalled();
    expect(hooks.giveUp).not.toHaveBeenCalled();
  });

  it("cancel clears the pending restart", async () => {
    const restarter = new StreamLossRestarter(hooks);
    restarter.onLost(5000);
    restarter.cancel();
    await vi.advanceTimersByTimeAsync(60000);
    expect(hooks.restart).not.toHaveBeenCalled();
  });

  it("waits for the page to be shown before restarting, and cancel ends that wait", async () => {
    hidden = true;
    const restarter = new StreamLossRestarter(hooks);
    restarter.onLost(5000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_BACKOFF_MS[0]);
    expect(hooks.restart).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.restart).toHaveBeenCalledTimes(1);

    hidden = true;
    restarter.onLost(1000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_BACKOFF_MS[1]);
    restarter.cancel();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.restart).toHaveBeenCalledTimes(1);
  });
});

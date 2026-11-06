import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import {
  STREAM_RECOVERY_DELAY_MS,
  STREAM_RECOVERY_STABLE_MS,
  StreamLossRecovery,
  StreamLossRestarter,
  type StreamLossRestarterHooks,
} from "@/lib/streams/streamLossRecovery";

describe("StreamLossRecovery", () => {
  it("restarts the first loss and yields every later loss in the same episode", () => {
    const recovery = new StreamLossRecovery();
    expect([recovery.noteLost(0), recovery.noteLost(0), recovery.noteLost(0)]).toEqual(["restart", "yield", "yield"]);
  });

  it("keeps yielding when the restarted stream was live for less than the stable period", () => {
    const recovery = new StreamLossRecovery();
    recovery.noteLost(0);
    expect(recovery.noteLost(STREAM_RECOVERY_STABLE_MS - 1)).toBe("yield");
  });

  it("restarts again when the stream was live for the stable period", () => {
    const recovery = new StreamLossRecovery();
    recovery.noteLost(0);
    expect(recovery.noteLost(STREAM_RECOVERY_STABLE_MS)).toBe("restart");
  });

  it("starts a fresh episode after reset", () => {
    const recovery = new StreamLossRecovery();
    recovery.noteLost(0);
    recovery.reset();
    expect(recovery.noteLost(0)).toBe("restart");
  });
});

describe("StreamLossRestarter", () => {
  let hooks: StreamLossRestarterHooks & {
    restart: ReturnType<typeof vi.fn>;
    giveUp: ReturnType<typeof vi.fn>;
    yieldToOtherClient: ReturnType<typeof vi.fn>;
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
      yieldToOtherClient: vi.fn(),
      isPageHidden: () => hidden,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restarts after the delay when Watch is wanted and the device answers", async () => {
    const restarter = new StreamLossRestarter(hooks);
    expect(restarter.onLost(5000)).toBe(true);
    expect(hooks.restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);
    expect(hooks.restart).toHaveBeenCalledTimes(1);
  });

  it("does not restart, and reports no restart, when Watch is no longer wanted", async () => {
    const restarter = new StreamLossRestarter({ ...hooks, isWanted: () => false });
    expect(restarter.onLost(5000)).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(hooks.restart).not.toHaveBeenCalled();
  });

  it("does not take back a stream lost again soon after its restart, and says another client has it", async () => {
    const restarter = new StreamLossRestarter(hooks);
    expect(restarter.onLost(1000)).toBe(true);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);
    expect(restarter.onLost(1000)).toBe(false);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);

    expect(hooks.restart).toHaveBeenCalledTimes(1);
    expect(hooks.yieldToOtherClient).toHaveBeenCalledTimes(1);
    expect(hooks.giveUp).not.toHaveBeenCalled();
  });

  it("reports a plain loss, not another client, when the device stops answering after the restart", async () => {
    const restarter = new StreamLossRestarter(hooks);
    restarter.onLost(1000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);
    hooks.deviceAnswers.mockResolvedValue(false);
    restarter.onLost(1000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);

    expect(hooks.yieldToOtherClient).not.toHaveBeenCalled();
    expect(hooks.giveUp).toHaveBeenCalledTimes(1);
  });

  it("gives up without restarting when the device does not answer REST", async () => {
    hooks.deviceAnswers.mockResolvedValue(false);
    const restarter = new StreamLossRestarter(hooks);
    restarter.onLost(5000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);
    expect(hooks.restart).not.toHaveBeenCalled();
    expect(hooks.giveUp).toHaveBeenCalledTimes(1);
  });

  it("gives up when the restart itself throws", async () => {
    hooks.restart.mockRejectedValue(new Error("boom"));
    const restarter = new StreamLossRestarter(hooks);
    restarter.onLost(5000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);
    expect(hooks.giveUp).toHaveBeenCalledTimes(1);
  });

  it("does not touch the device when the video came back before the restart was due", async () => {
    let lost = true;
    const restarter = new StreamLossRestarter({ ...hooks, isLost: () => lost });
    restarter.onLost(5000);
    lost = false;

    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);

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

    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);

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
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);
    expect(hooks.restart).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.restart).toHaveBeenCalledTimes(1);

    hidden = true;
    restarter.onLost(1000);
    await vi.advanceTimersByTimeAsync(STREAM_RECOVERY_DELAY_MS);
    restarter.cancel();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.restart).toHaveBeenCalledTimes(1);
  });
});

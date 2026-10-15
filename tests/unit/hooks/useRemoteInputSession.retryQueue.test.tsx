/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMachineInputBatchMock = vi.fn(async (_batch: unknown) => ({
  errors: [],
  keyboard: { inputs: [] },
  joysticks: [],
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ sendMachineInputBatch: sendMachineInputBatchMock, getDeviceHost: () => "test-host" }),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: (error: Error, context: Record<string, unknown>) => ({ error: error.message, ...context }),
}));

import { useRemoteInputSession } from "@/hooks/useRemoteInputSession";
import { resetMachineInputThrottleForTests } from "@/lib/remoteInput/machineInputThrottle";

const noAnswer = () => new Error("The C64 did not answer within 1.5 s");
const settle = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const failFirstSendLater = () => {
  let fail: () => void = () => undefined;
  sendMachineInputBatchMock.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = () => reject(noAnswer());
      }),
  );
  return () => fail();
};
const sentBatches = () => sendMachineInputBatchMock.mock.calls.map(([batch]) => batch);
const typedOne = { events: [{ kind: "keyboard", inputs: ["1"], transition: "tap" }] };

// The real serialized queue, so a retry can be seen holding input behind it.
describe("useRemoteInputSession typed-key retry and the serialized machine:input queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMachineInputBatchMock.mockClear();
    resetMachineInputThrottleForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the timed-out key once more when nothing is queued behind it", async () => {
    const fail = failFirstSendLater();
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.sendChar("1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    await act(async () => {
      fail();
      await settle();
    });

    expect(sentBatches()).toEqual([typedOne, typedOne]);
  });

  it("does not hold joystick input queued behind it for a second attempt", async () => {
    const fail = failFirstSendLater();
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.sendChar("1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sentBatches()).toEqual([typedOne]);

    await act(async () => {
      fail();
      await settle();
    });

    // The ordinary failure path runs at once: the queued press is superseded and released (HARD18-001, HARD15-007).
    expect(sentBatches()).toEqual([typedOne, { events: [{ kind: "release_all" }] }]);
  });
});

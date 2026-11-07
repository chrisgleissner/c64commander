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

  it("still sends the keys typed behind a key that got no answer", async () => {
    const fail = failFirstSendLater();
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    act(() => result.current.sendChar("1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    for (const char of ["2", "3"]) {
      act(() => result.current.sendChar(char));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
    }
    expect(sentBatches()).toEqual([typedOne]);

    await act(async () => {
      fail();
      await settle();
      await vi.advanceTimersByTimeAsync(500);
    });

    // "1" is not sent again, because input waits behind it; "2" and "3" must not be lost with it.
    expect(sentBatches()).toEqual([
      typedOne,
      { events: [{ kind: "keyboard", inputs: ["2"], transition: "tap" }] },
      { events: [{ kind: "keyboard", inputs: ["3"], transition: "tap" }] },
    ]);
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
    expect(sentBatches()).toEqual([
      typedOne,
      { events: [{ kind: "joystick", port: 2, inputs: ["up"], transition: "release" }] },
    ]);
  });

  describe("releasing what this phone pressed while its batches were still queued", () => {
    const holdNextSend = () => {
      const control = { resolve: () => undefined as void, reject: () => undefined as void };
      sendMachineInputBatchMock.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            control.resolve = () => resolve({ errors: [], keyboard: { inputs: [] }, joysticks: [] });
            control.reject = () => reject(noAnswer());
          }),
      );
      return control;
    };
    const hold = async (result: { current: ReturnType<typeof useRemoteInputSession> }, inputs: string[]) => {
      act(() => result.current.setHeldJoystickInputs(new Set(inputs) as never));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    };
    const releasedJoystickInputs = (batch: unknown) =>
      (batch as { events: Array<{ transition: string; inputs: string[] }> }).events
        .filter((event) => event.transition === "release")
        .flatMap((event) => [...event.inputs].sort());

    it("recovery release after a failed press also frees an input pressed in an earlier confirmed batch", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      await hold(result, ["up"]);
      await act(async () => settle());
      const firePress = holdNextSend();
      await hold(result, ["up", "fire"]);
      await hold(result, []);
      expect(sentBatches()).toHaveLength(2);

      await act(async () => {
        firePress.reject();
        await settle();
      });

      expect(sentBatches()).toHaveLength(3);
      expect(releasedJoystickInputs(sentBatches()[2])).toEqual(["fire", "up"]);
    });

    it("recovery release still frees an input pressed again after a queued release of it was dispatched", async () => {
      const okReply = { errors: [], keyboard: { inputs: [] }, joysticks: [] };
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      await hold(result, ["fire"]);
      await act(async () => settle());
      const upPress = holdNextSend();
      sendMachineInputBatchMock.mockResolvedValueOnce(okReply).mockResolvedValueOnce(okReply);
      await hold(result, ["fire", "up"]);
      await hold(result, ["up"]);
      await hold(result, ["up", "fire"]);
      const leftPress = holdNextSend();
      await hold(result, ["up", "fire", "left"]);
      await hold(result, ["up", "left"]);
      expect(sentBatches()).toHaveLength(2);

      await act(async () => {
        upPress.resolve();
        await settle();
      });
      expect(sentBatches()).toHaveLength(5);

      await act(async () => {
        leftPress.reject();
        await settle();
      });

      expect(sentBatches()).toHaveLength(6);
      expect(releasedJoystickInputs(sentBatches()[5])).toEqual(["fire", "left", "up"]);
    });

    it("the own release on sheet close also frees inputs whose queued release it supersedes", async () => {
      const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
      await hold(result, ["up"]);
      await act(async () => settle());
      const firePress = holdNextSend();
      await hold(result, ["up", "fire"]);
      await hold(result, []);
      await hold(result, ["left"]);
      expect(sentBatches()).toHaveLength(2);

      act(() => result.current.releaseHeldInputs());

      expect(sentBatches()).toHaveLength(3);
      expect(releasedJoystickInputs(sentBatches()[2])).toEqual(["fire", "left", "up"]);
      await act(async () => {
        firePress.resolve();
        await settle();
      });
    });
  });
});

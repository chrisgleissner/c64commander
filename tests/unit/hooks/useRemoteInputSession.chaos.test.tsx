/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Chaos/stress coverage for the HARD12-017 remote input transport, using the
 * REAL machineInputThrottle module (unlike useRemoteInputSession.test.tsx,
 * which mocks it out to keep coalescing-window assertions exact). Each test
 * simulates a short, time-bounded (<=5s simulated) burst of chaotic input and
 * asserts the device constraint the plan cares about: every genuine change
 * the user made is eventually relayed - nothing is silently dropped forever,
 * even under the device-safeguard rate limit - while safety-critical
 * releases are never delayed behind it.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMachineInputBatchMock = vi.fn(async () => ({ errors: [], keyboard: { inputs: [] }, joysticks: [] }));
const addErrorLogMock = vi.fn();
const deviceSafetyConfigState = { machineInputCooldownMs: 100 };

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ sendMachineInputBatch: sendMachineInputBatchMock }),
}));

vi.mock("@/lib/playback/autostart", () => ({
  injectAutostart: async () => undefined,
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
  buildErrorLogDetails: (error: Error, context: Record<string, unknown>) => ({ error: error.message, ...context }),
}));

vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: () => deviceSafetyConfigState,
}));

import { useRemoteInputSession } from "@/hooks/useRemoteInputSession";
import { resetMachineInputThrottleForTests } from "@/lib/remoteInput/machineInputThrottle";

describe("useRemoteInputSession chaos/stress (real device-safeguard throttle)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMachineInputBatchMock.mockClear();
    addErrorLogMock.mockClear();
    deviceSafetyConfigState.machineInputCooldownMs = 100;
    resetMachineInputThrottleForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("relays every direction reached during 5s of chaotic random stick input, throttled but never stuck (BALANCED, 100ms/10-per-sec)", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    const directionPool = [
      new Set(["up"] as const),
      new Set(["down"] as const),
      new Set(["left"] as const),
      new Set(["right"] as const),
      new Set(["up", "right"] as const),
      new Set(["fire"] as const),
    ];
    // Deterministic pseudo-random walk, not Math.random() (banned - ambient,
    // non-reproducible). 50 changes over 5 simulated seconds: one roughly
    // every 100ms, faster than most real thumbs but a realistic upper bound.
    let seed = 1;
    const nextIndex = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % directionPool.length;
    };

    for (let i = 0; i < 50; i += 1) {
      act(() => result.current.setHeldJoystickInputs(directionPool[nextIndex()]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    // Let any final in-flight throttle wait resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(sendMachineInputBatchMock.mock.calls.length).toBeGreaterThan(0);
    expect(result.current.connectionStatus).not.toBe("error");

    // The device's last-known state (as reconstructed from every sent diff)
    // must match the LAST direction the user actually held - nothing about
    // the throttle may leave the relayed state behind the true held state.
    const finalHeld = new Set<string>();
    for (const call of sendMachineInputBatchMock.mock.calls) {
      for (const event of call[0].events as Array<{ transition: string; inputs?: string[] }>) {
        if (event.transition === "press") event.inputs?.forEach((input) => finalHeld.add(input));
        if (event.transition === "release") event.inputs?.forEach((input) => finalHeld.delete(input));
      }
    }
    expect(finalHeld).toEqual(directionPool[seed % directionPool.length]);
  }, 5000);

  it("never exceeds the configured rate (10/sec = >=100ms between consecutive sends) even under a tight input storm", async () => {
    const sendTimestamps: number[] = [];
    sendMachineInputBatchMock.mockImplementation(async () => {
      sendTimestamps.push(Date.now());
      return { errors: [], keyboard: { inputs: [] }, joysticks: [] };
    });
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));
    // A wider, irregular direction pool (not a clean 2-state alternation,
    // which can land back on the last-SENT state exactly at a coalesce
    // boundary and legitimately produce a no-op diff/no send for that tick).
    const directionPool = [
      new Set(["up"] as const),
      new Set(["down"] as const),
      new Set(["left"] as const),
      new Set(["right"] as const),
      new Set(["fire"] as const),
    ];
    let seed = 7;
    const nextIndex = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % directionPool.length;
    };

    for (let i = 0; i < 30; i += 1) {
      act(() => result.current.setHeldJoystickInputs(directionPool[nextIndex()]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20); // faster than the device can safely take it
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(sendTimestamps.length).toBeGreaterThan(1);
    for (let i = 1; i < sendTimestamps.length; i += 1) {
      expect(sendTimestamps[i] - sendTimestamps[i - 1]).toBeGreaterThanOrEqual(100);
    }
    // Far fewer network calls than input changes - the throttle is doing its job.
    expect(sendTimestamps.length).toBeLessThan(30);
  }, 5000);

  it("bypasses the throttle for a panic-button release even while a throttled send is still pending", async () => {
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    // Establish a baseline send first (the throttle's very first-ever call
    // always resolves instantly, with nothing to measure elapsed time
    // against - so the huge cooldown below must apply to the SECOND send).
    act(() => result.current.setHeldJoystickInputs(new Set(["up"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1);

    deviceSafetyConfigState.machineInputCooldownMs = 2000; // deliberately huge
    act(() => result.current.setHeldJoystickInputs(new Set(["up", "right"])));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40); // coalesce window elapses, throttle wait begins (2000ms)
    });
    expect(sendMachineInputBatchMock).toHaveBeenCalledTimes(1); // still waiting out the huge cooldown

    act(() => result.current.releaseAll());
    // No further time advance needed: releaseAll is immediate/unthrottled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sendMachineInputBatchMock).toHaveBeenCalledWith({ events: [{ kind: "release_all" }] });
  }, 5000);

  it("removes the throttle entirely under a 0ms (RELAXED) cooldown, relaying as fast as the user can press", async () => {
    deviceSafetyConfigState.machineInputCooldownMs = 0;
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    for (let i = 0; i < 10; i += 1) {
      act(() => result.current.setHeldJoystickInputs(i % 2 === 0 ? new Set(["up"]) : new Set(["down"])));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40); // exactly the coalesce window, no extra throttle delay
      });
    }

    expect(sendMachineInputBatchMock.mock.calls.length).toBeGreaterThan(0);
    const lastEvents = sendMachineInputBatchMock.mock.calls.at(-1)?.[0].events as Array<{
      transition: string;
      inputs: string[];
    }>;
    expect(lastEvents.find((e) => e.transition === "press")?.inputs).toEqual(["down"]);
  }, 5000);

  it("recovers cleanly after a send fails mid-chaos, without ever throwing out of the hook", async () => {
    sendMachineInputBatchMock.mockRejectedValueOnce(new Error("transient device error"));
    const { result } = renderHook(() => useRemoteInputSession({ tier: "full" }));

    await expect(
      (async () => {
        for (let i = 0; i < 15; i += 1) {
          act(() => result.current.setHeldJoystickInputs(i % 3 === 0 ? new Set(["fire"]) : new Set(["up"])));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
          });
        }
      })(),
    ).resolves.not.toThrow();

    expect(sendMachineInputBatchMock.mock.calls.length).toBeGreaterThan(1);
  }, 5000);
});

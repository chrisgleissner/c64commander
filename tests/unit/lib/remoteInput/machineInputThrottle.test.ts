/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadDeviceSafetyConfigMock = vi.fn();

vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: () => loadDeviceSafetyConfigMock(),
}));

import { resetMachineInputThrottleForTests, runSerializedMachineInput } from "@/lib/remoteInput/machineInputThrottle";

describe("runSerializedMachineInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMachineInputThrottleForTests();
    loadDeviceSafetyConfigMock.mockReturnValue({ machineInputCooldownMs: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Issue 3d: the core device-safety guarantee for machine:input - never two
  // calls in flight at once, so the Ultimate's single-threaded network task
  // never sees overlapping requests. The second dispatch must not START until
  // the first has fully settled.
  it("never lets two dispatches overlap - the second does not start until the first settles", async () => {
    const started: string[] = [];
    let resolveFirst!: () => void;
    const first = runSerializedMachineInput(() => {
      started.push("first");
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const second = runSerializedMachineInput(() => {
      started.push("second");
      return Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["first"]); // second is queued behind the still-in-flight first

    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second]);
    expect(started).toEqual(["first", "second"]);
  });

  // Issue 3d: with the default 0ms cooldown the only spacing is the real call
  // latency, so a serialized burst runs back-to-back (never overlapping) in order.
  it("runs dispatches back-to-back in order with zero added delay when the cooldown is 0", async () => {
    const order: number[] = [];
    const dispatches = [1, 2, 3].map((n) =>
      runSerializedMachineInput(() => {
        order.push(n);
        return Promise.resolve();
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    await Promise.all(dispatches);
    expect(order).toEqual([1, 2, 3]);
  });

  it("applies an optional cooldown floor measured from the previous dispatch's completion", async () => {
    loadDeviceSafetyConfigMock.mockReturnValue({ machineInputCooldownMs: 100 });
    await runSerializedMachineInput(() => Promise.resolve()); // first: nothing to wait behind

    let secondStarted = false;
    const second = runSerializedMachineInput(() => {
      secondStarted = true;
      return Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(secondStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(secondStarted).toBe(true);
  });

  it("re-reads the cooldown on every dispatch, so a mid-session mode change takes effect immediately", async () => {
    loadDeviceSafetyConfigMock.mockReturnValue({ machineInputCooldownMs: 100 });
    await runSerializedMachineInput(() => Promise.resolve());

    loadDeviceSafetyConfigMock.mockReturnValue({ machineInputCooldownMs: 0 });
    let secondStarted = false;
    const second = runSerializedMachineInput(() => {
      secondStarted = true;
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(0);
    await second;
    expect(secondStarted).toBe(true);
  });

  it("keeps the queue healthy after a dispatch rejects - a later dispatch still runs", async () => {
    const failing = runSerializedMachineInput(() => Promise.reject(new Error("transient device error")));
    await expect(failing).rejects.toThrow("transient device error");

    let laterRan = false;
    await runSerializedMachineInput(() => {
      laterRan = true;
      return Promise.resolve();
    });
    expect(laterRan).toBe(true);
  });

  it("does not overlap even when a dispatch rejects - the next waits for the failed one to settle first", async () => {
    const started: string[] = [];
    let rejectFirst!: (error: Error) => void;
    const first = runSerializedMachineInput(() => {
      started.push("first");
      return new Promise<void>((_, reject) => {
        rejectFirst = reject;
      });
    });
    const second = runSerializedMachineInput(() => {
      started.push("second");
      return Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["first"]);

    rejectFirst(new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    await second;
    expect(started).toEqual(["first", "second"]);
  });
});

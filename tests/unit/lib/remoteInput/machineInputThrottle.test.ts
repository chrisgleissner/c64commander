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

import { resetMachineInputThrottleForTests, waitForMachineInputThrottle } from "@/lib/remoteInput/machineInputThrottle";

describe("waitForMachineInputThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMachineInputThrottleForTests();
    loadDeviceSafetyConfigMock.mockReturnValue({ machineInputCooldownMs: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately on the first call regardless of the configured cooldown", async () => {
    let resolved = false;
    void waitForMachineInputThrottle().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("waits out the remainder of the cooldown on a call that arrives too soon", async () => {
    await waitForMachineInputThrottle();
    vi.advanceTimersByTime(40); // 60ms remaining of the 100ms cooldown

    let resolved = false;
    void waitForMachineInputThrottle().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(59);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("resolves immediately once the cooldown has already fully elapsed", async () => {
    await waitForMachineInputThrottle();
    vi.advanceTimersByTime(100);

    let resolved = false;
    void waitForMachineInputThrottle().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("never waits when the configured cooldown is 0 (RELAXED, 'as many as the user can press')", async () => {
    loadDeviceSafetyConfigMock.mockReturnValue({ machineInputCooldownMs: 0 });
    await waitForMachineInputThrottle();

    let resolved = false;
    void waitForMachineInputThrottle().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("re-reads the cooldown on every call, so a mid-session mode change takes effect immediately", async () => {
    await waitForMachineInputThrottle();
    loadDeviceSafetyConfigMock.mockReturnValue({ machineInputCooldownMs: 0 });

    let resolved = false;
    void waitForMachineInputThrottle().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  // Regression (found by chaos-testing useRemoteInputSession): two callers
  // that both invoke waitForMachineInputThrottle() in the SAME tick (before
  // either has updated lastSentAtMs) used to both read the same stale
  // baseline and both resolve immediately, letting two sends land with zero
  // gap between them - silently defeating the whole rate limit. Calls must
  // be serialized so the second one always sees the first one's effect.
  it("serializes two truly-simultaneous callers instead of letting both slip through with zero gap", async () => {
    await waitForMachineInputThrottle(); // establishes the baseline
    vi.advanceTimersByTime(10); // only 10ms elapsed of the 100ms cooldown

    const resolvedAtMs: number[] = [];
    const first = waitForMachineInputThrottle().then(() => resolvedAtMs.push(Date.now()));
    const second = waitForMachineInputThrottle().then(() => resolvedAtMs.push(Date.now()));

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([first, second]);

    expect(resolvedAtMs).toHaveLength(2);
    expect(resolvedAtMs[1] - resolvedAtMs[0]).toBeGreaterThanOrEqual(100);
  });
});

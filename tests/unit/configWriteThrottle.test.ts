/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigWriteCancelledError,
  scheduleConfigWrite,
  resetConfigWriteThrottle,
} from "@/lib/config/configWriteThrottle";
import { saveConfigWriteIntervalMs } from "@/lib/config/appSettings";
import { saveDeviceSafetyMode } from "@/lib/config/deviceSafetySettings";
import { addErrorLog, addLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

describe("configWriteThrottle", () => {
  beforeEach(() => {
    localStorage.clear();
    resetConfigWriteThrottle();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveConfigWriteIntervalMs(500);
    vi.mocked(addErrorLog).mockClear();
    vi.mocked(addLog).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("spaces consecutive config writes by the configured interval", async () => {
    const times: number[] = [];
    const task = async () => {
      times.push(Date.now());
      return true;
    };

    const first = scheduleConfigWrite(task);
    const second = scheduleConfigWrite(task);

    await first;
    expect(times).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(500);
    await second;

    expect(times).toEqual([1000, 1500]);
  });

  it("uses the Device Safety config cooldown when it is more conservative than the app write interval", async () => {
    saveConfigWriteIntervalMs(100);
    saveDeviceSafetyMode("CONSERVATIVE");
    resetConfigWriteThrottle();
    const times: number[] = [];
    const task = async () => {
      times.push(Date.now());
      return true;
    };

    const first = scheduleConfigWrite(task);
    const second = scheduleConfigWrite(task);

    await first;
    await vi.advanceTimersByTimeAsync(1199);
    expect(times).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(1);
    await second;

    expect(times).toEqual([1000, 2200]);
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Config write backoff delay applied",
      expect.objectContaining({
        waitMs: 1200,
        appIntervalMs: 100,
        deviceSafetyConfigsCooldownMs: 1200,
      }),
    );
  });

  it("logs failed tasks and continues the queue", async () => {
    const failingTask = async () => {
      throw new Error("write failed");
    };
    const successTask = async () => "ok";

    const first = scheduleConfigWrite(failingTask);
    const second = scheduleConfigWrite(successTask);

    await expect(first).rejects.toThrow("write failed");

    await vi.advanceTimersByTimeAsync(500);
    const result = await second;

    expect(result).toBe("ok");
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "Config write queue: preceding task failed",
      expect.objectContaining({ error: "write failed" }),
    );
  });

  it("cancels queued writes on reset before they can run against a new selected device", async () => {
    const firstTask = vi.fn(async () => "old-device-first");
    const staleTask = vi.fn(async () => "old-device-stale");

    const first = scheduleConfigWrite(firstTask);
    const stale = scheduleConfigWrite(staleTask);

    await expect(first).resolves.toBe("old-device-first");
    expect(firstTask).toHaveBeenCalledTimes(1);

    resetConfigWriteThrottle("saved-device-switch");
    await expect(stale).rejects.toMatchObject({
      name: "ConfigWriteCancelledError",
      reason: "saved-device-switch",
      isCancellation: true,
    });
    await expect(stale).rejects.toBeInstanceOf(ConfigWriteCancelledError);
    expect(staleTask).not.toHaveBeenCalled();
    expect(addErrorLog).not.toHaveBeenCalledWith(
      "Config write queue: preceding task failed",
      expect.objectContaining({ error: expect.stringContaining("cancelled") }),
    );
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Config write queue task cancelled",
      expect.objectContaining({ reason: "saved-device-switch" }),
    );

    const newDeviceTask = vi.fn(async () => "new-device");
    await expect(scheduleConfigWrite(newDeviceTask)).resolves.toBe("new-device");
    expect(newDeviceTask).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued write while it is waiting for the config-write cooldown", async () => {
    const firstTask = vi.fn(async () => "first");
    const staleTask = vi.fn(async () => "stale");

    const first = scheduleConfigWrite(firstTask);
    const stale = scheduleConfigWrite(staleTask);

    await expect(first).resolves.toBe("first");
    await vi.advanceTimersByTimeAsync(100);

    resetConfigWriteThrottle("saved-device-switch");

    await expect(stale).rejects.toMatchObject({
      name: "ConfigWriteCancelledError",
      reason: "saved-device-switch",
      isCancellation: true,
    });
    expect(staleTask).not.toHaveBeenCalled();
  });

  it("spaces a sustained checkbox-style burst and preserves the final intended state", async () => {
    saveConfigWriteIntervalMs(100);
    saveDeviceSafetyMode("RELAXED");
    const intendedStates = Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? "Enabled" : "Disabled"));
    const startedAt: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let finalState = "Unknown";

    const writes = intendedStates.map((state) =>
      scheduleConfigWrite(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        startedAt.push(Date.now());
        finalState = state;
        await Promise.resolve();
        inFlight -= 1;
        return state;
      }),
    );

    await vi.advanceTimersByTimeAsync(200 * intendedStates.length);
    await expect(Promise.all(writes)).resolves.toEqual(intendedStates);

    expect(maxInFlight).toBe(1);
    expect(finalState).toBe(intendedStates.at(-1));
    expect(startedAt).toHaveLength(intendedStates.length);
    expect(startedAt[0]).toBe(1000);
    startedAt.slice(1).forEach((timestamp, index) => {
      expect(timestamp - startedAt[index]).toBeGreaterThanOrEqual(200);
    });
  });
});

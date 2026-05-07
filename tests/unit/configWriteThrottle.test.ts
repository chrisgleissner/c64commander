/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleConfigWrite, resetConfigWriteThrottle } from "@/lib/config/configWriteThrottle";
import { saveConfigWriteIntervalMs } from "@/lib/config/appSettings";
import { addErrorLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
}));

describe("configWriteThrottle", () => {
  beforeEach(() => {
    localStorage.clear();
    resetConfigWriteThrottle();
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveConfigWriteIntervalMs(500);
    vi.mocked(addErrorLog).mockClear();
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

  it("spaces a sustained checkbox-style burst and preserves the final intended state", async () => {
    saveConfigWriteIntervalMs(100);
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

    await vi.advanceTimersByTimeAsync(100 * intendedStates.length);
    await expect(Promise.all(writes)).resolves.toEqual(intendedStates);

    expect(maxInFlight).toBe(1);
    expect(finalState).toBe(intendedStates.at(-1));
    expect(startedAt).toHaveLength(intendedStates.length);
    expect(startedAt[0]).toBe(1000);
    startedAt.slice(1).forEach((timestamp, index) => {
      expect(timestamp - startedAt[index]).toBeGreaterThanOrEqual(100);
    });
  });
});

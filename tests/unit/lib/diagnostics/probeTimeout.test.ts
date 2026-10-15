/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withProbeTimeout } from "@/lib/diagnostics/probeTimeout";

const message = (ms: number) => `RASTER timed out after ${ms}ms`;

const settleAfter = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("withProbeTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the timeout at once for a probe without a queue budget", async () => {
    const result = withProbeTimeout(() => new Promise<string>(() => {}), { timeoutMs: 1500, timeoutMessage: message });
    const assertion = expect(result).rejects.toThrow("RASTER timed out after 1500ms");
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
  });

  it("does not count time spent in the app's queue against the device", async () => {
    const result = withProbeTimeout(
      async (onDispatch) => {
        await settleAfter(4000, null);
        onDispatch();
        return settleAfter(30, "answered");
      },
      { timeoutMs: 1500, timeoutMessage: message, queueBudgetMs: 12_000 },
    );
    await vi.advanceTimersByTimeAsync(4030);
    await expect(result).resolves.toBe("answered");
  });

  it("times out a dispatched probe once the device has had its full timeout", async () => {
    let dispatchedAt = 0;
    const result = withProbeTimeout(
      async (onDispatch) => {
        await settleAfter(2000, null);
        dispatchedAt = Date.now();
        onDispatch();
        onDispatch();
        return new Promise<string>(() => {});
      },
      { timeoutMs: 1500, timeoutMessage: message, queueBudgetMs: 12_000 },
    );
    const assertion = expect(result).rejects.toThrow("RASTER timed out after 1500ms");
    await vi.advanceTimersByTimeAsync(3499);
    expect(dispatchedAt).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it("bounds the wait in the queue by the queue budget", async () => {
    const result = withProbeTimeout(() => new Promise<string>(() => {}), {
      timeoutMs: 1500,
      timeoutMessage: message,
      queueBudgetMs: 5000,
    });
    const assertion = expect(result).rejects.toThrow("RASTER timed out after 5000ms before it could be sent");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("keeps a probe dispatched late inside the queue budget", async () => {
    const result = withProbeTimeout(
      async (onDispatch) => {
        await settleAfter(4500, null);
        onDispatch();
        return new Promise<string>(() => {});
      },
      { timeoutMs: 1500, timeoutMessage: message, queueBudgetMs: 5000 },
    );
    const assertion = expect(result).rejects.toThrow("RASTER timed out after 500ms");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});

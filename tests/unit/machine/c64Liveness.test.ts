/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { checkC64Liveness } from "@/lib/machine/c64Liveness";

type MockApi = {
  readMemory: (address: string, length: number) => Promise<Uint8Array>;
};

const buildApi = (responses: Record<string, Uint8Array[]>) => {
  const counters = new Map<string, number>();
  return {
    readMemory: async (address: string, length: number) => {
      const key = `${address}:${length}`;
      const index = counters.get(key) ?? 0;
      counters.set(key, index + 1);
      const values = responses[key] ?? [];
      const value =
        values[Math.min(index, values.length - 1)] ?? new Uint8Array(length);
      return value;
    },
  } satisfies MockApi;
};

describe("checkC64Liveness", () => {
  it("reports healthy when jiffy advances", async () => {
    const api = buildApi({
      "00A2:3": [new Uint8Array([1, 0, 0]), new Uint8Array([2, 0, 0])],
      "D012:1": [new Uint8Array([10]), new Uint8Array([11])],
    });

    const result = await checkC64Liveness(api as any, {
      jiffyWaitMs: 0,
      rasterAttempts: 1,
      rasterDelayMs: 0,
    });

    expect(result.decision).toBe("healthy");
    expect(result.jiffyAdvanced).toBe(true);
  });

  it("reports irq-stalled when jiffy stalls but raster changes", async () => {
    const api = buildApi({
      "00A2:3": [new Uint8Array([1, 0, 0]), new Uint8Array([1, 0, 0])],
      "D012:1": [new Uint8Array([10]), new Uint8Array([12])],
    });

    const result = await checkC64Liveness(api as any, {
      jiffyWaitMs: 0,
      rasterAttempts: 2,
      rasterDelayMs: 0,
    });

    expect(result.decision).toBe("irq-stalled");
    expect(result.rasterChanged).toBe(true);
  });

  it("reports wedged when jiffy and raster stall", async () => {
    const api = buildApi({
      "00A2:3": [new Uint8Array([1, 0, 0]), new Uint8Array([1, 0, 0])],
      "D012:1": [new Uint8Array([10]), new Uint8Array([10])],
    });

    const result = await checkC64Liveness(api as any, {
      jiffyWaitMs: 0,
      rasterAttempts: 1,
      rasterDelayMs: 0,
    });

    expect(result.decision).toBe("wedged");
    expect(result.rasterChanged).toBe(false);
  });

  it("throws when readMemory returns zero bytes", async () => {
    const api = buildApi({
      "00A2:3": [new Uint8Array(0)],
      "D012:1": [new Uint8Array(0)],
    });

    await expect(
      checkC64Liveness(api as any, {
        jiffyWaitMs: 0,
        rasterAttempts: 1,
        rasterDelayMs: 0,
      }),
    ).rejects.toThrow("read returned 0 byte(s); expected 3");
  });

  it("reports irq-stalled when raster changes on second attempt", async () => {
    const api = buildApi({
      "00A2:3": [new Uint8Array([1, 0, 0]), new Uint8Array([1, 0, 0])],
      // rasterStart=10, attempt0=10 (no change), attempt1=20 (changed)
      "D012:1": [
        new Uint8Array([10]),
        new Uint8Array([10]),
        new Uint8Array([20]),
      ],
    });

    const result = await checkC64Liveness(api as any, {
      jiffyWaitMs: 0,
      rasterAttempts: 2,
      rasterDelayMs: 0,
    });

    expect(result.decision).toBe("irq-stalled");
    expect(result.rasterChanged).toBe(true);
    expect(result.rasterEnd).toBe(20);
  });

  it("uses default rasterAttempts when option is omitted", async () => {
    const api = buildApi({
      "00A2:3": [new Uint8Array([5, 0, 0]), new Uint8Array([6, 0, 0])],
      "D012:1": [new Uint8Array([10])],
    });

    const result = await checkC64Liveness(api as any, {
      jiffyWaitMs: 0,
      rasterDelayMs: 0,
    });

    // rasterAttempts defaults to 3; jiffy advanced → healthy regardless
    expect(result.decision).toBe("healthy");
  });

  it("clamps rasterAttempts to 1 when zero is passed", async () => {
    const api = buildApi({
      "00A2:3": [new Uint8Array([1, 0, 0]), new Uint8Array([2, 0, 0])],
      "D012:1": [new Uint8Array([10])],
    });

    const result = await checkC64Liveness(api as any, {
      jiffyWaitMs: 0,
      rasterAttempts: 0,
      rasterDelayMs: 0,
    });

    expect(result.decision).toBe("healthy");
  });

  it("wraps non-Error thrown during readMemory", async () => {
    const badApi = {
      readMemory: async () => {
        throw "unexpected failure";
      },
    };

    await expect(
      checkC64Liveness(badApi as any, {
        jiffyWaitMs: 0,
        rasterAttempts: 1,
        rasterDelayMs: 0,
      }),
    ).rejects.toThrow("Liveness check failed");
  });

  it("uses default jiffyWaitMs, rasterAttempts and rasterDelayMs when no options provided", async () => {
    // Covers the options.jiffyWaitMs ?? DEFAULT_JIFFY_WAIT_MS and similar ?? fallback branches
    const api = buildApi({
      "00A2:3": [new Uint8Array([1, 0, 0]), new Uint8Array([2, 0, 0])],
      "D012:1": [new Uint8Array([10]), new Uint8Array([10])],
    });

    // No options argument — all three ?? defaults fire
    const result = await checkC64Liveness(api as any);
    expect(result.decision).toBe("healthy");
  });
});

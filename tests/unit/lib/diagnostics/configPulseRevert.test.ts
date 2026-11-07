/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { decideConfigPulseRevert, watchForReturnedPulseValue } from "@/lib/diagnostics/configPulseRevert";

const base = { originalValue: 5, tempValue: 21 };

describe("decideConfigPulseRevert", () => {
  it("reverts only when the value read just before the revert is the pulse value", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: 21 })).toBe("revert");
    expect(decideConfigPulseRevert({ ...base, readBackValue: null, preRevertValue: 21 })).toBe("revert");
  });

  it("treats another value read before the revert as another client's write, even when the readback missed it", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: 9 })).toBe("external-write");
    expect(decideConfigPulseRevert({ ...base, readBackValue: 9, preRevertValue: 9 })).toBe("external-write");
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: 5 })).toBe("external-write");
  });

  it("reports a pulse that never took effect when the original value is still present", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 5, preRevertValue: 5 })).toBe("not-applied");
    expect(decideConfigPulseRevert({ ...base, readBackValue: null, preRevertValue: 5 })).toBe("not-applied");
  });

  it("reports an unknown value when the read before the revert produced no number", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: null })).toBe("unknown");
  });
});

describe("watchForReturnedPulseValue", () => {
  const watch = { durationMs: 100, intervalMs: 25 };
  const noWait = () => Promise.resolve();

  it("stops at the first read that shows the pulse value again", async () => {
    const reads = [5, null, 21, 5];
    const readValue = vi.fn(() => Promise.resolve(reads.shift() ?? 5));

    await expect(watchForReturnedPulseValue(21, readValue, noWait, watch)).resolves.toBe(true);
    expect(readValue).toHaveBeenCalledTimes(3);
  });

  it("gives up at the wall-clock deadline when the pulse value never returns, however slow the reads", async () => {
    vi.useFakeTimers();
    try {
      const readValue = vi.fn(async () => {
        vi.advanceTimersByTime(60);
        return 9;
      });
      const wait = vi.fn(async (ms: number) => {
        vi.advanceTimersByTime(ms);
      });

      await expect(watchForReturnedPulseValue(21, readValue, wait, watch)).resolves.toBe(false);
      expect(readValue).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

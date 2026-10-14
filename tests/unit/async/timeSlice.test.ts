/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { createTimeSlicer } from "@/lib/async/timeSlice";

const callDue = (slice: { due: () => boolean }, times: number) => {
  let due = false;
  for (let i = 0; i < times; i += 1) due = slice.due() || due;
  return due;
};

describe("createTimeSlicer", () => {
  it("is not due while the slice is inside its budget", () => {
    let clock = 0;
    const slice = createTimeSlicer({ budgetMs: 10, now: () => clock, checkEvery: 1 });

    clock = 9;

    expect(slice.due()).toBe(false);
  });

  it("is due once the budget is spent, and not again until the next slice has used its own", async () => {
    let clock = 0;
    const wait = vi.fn(async () => {});
    const slice = createTimeSlicer({ budgetMs: 10, now: () => clock, wait, checkEvery: 1 });

    clock = 10;
    expect(slice.due()).toBe(true);
    await slice.yield();
    expect(wait).toHaveBeenCalledTimes(1);

    clock = 15;
    expect(slice.due()).toBe(false);
    clock = 20;
    expect(slice.due()).toBe(true);
  });

  it("reads the clock only once per checkEvery calls", () => {
    let clock = 0;
    const now = vi.fn(() => clock);
    const slice = createTimeSlicer({ budgetMs: 10, now, checkEvery: 32 });
    clock = 100;
    now.mockClear();

    expect(callDue(slice, 31)).toBe(false);
    expect(now).not.toHaveBeenCalled();
    expect(callDue(slice, 1)).toBe(true);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("lets a macrotask run between slices by default", async () => {
    const seen: string[] = [];
    const slice = createTimeSlicer();
    setTimeout(() => seen.push("timer"), 0);

    await slice.yield();
    seen.push("after-yield");

    expect(seen).toEqual(["timer", "after-yield"]);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { createLatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";

describe("createLatestIntentWriteLane", () => {
  it("drops superseded queued values before they start running", async () => {
    let allowRuns = false;
    const writes: number[] = [];
    const lane = createLatestIntentWriteLane<number>({
      beforeRun: async () => {
        while (!allowRuns) {
          await Promise.resolve();
        }
      },
      run: async (value) => {
        writes.push(value);
      },
    });

    const first = lane.schedule(1);
    const second = lane.schedule(2);
    const third = lane.schedule(3);

    allowRuns = true;
    await Promise.all([first, second, third]);

    expect(writes).toEqual([3]);
  });

  it("runs an abandoned scheduled intent to completion (H-07: final-value flush survives unmount)", async () => {
    const writes: number[] = [];
    let resolveRun!: () => void;
    const ran = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const lane = createLatestIntentWriteLane<number>({
      run: async (value) => {
        writes.push(value);
        resolveRun();
      },
    });

    // Fire-and-forget, as a component unmounting right after slider release:
    // nobody awaits the promise, but the write must still reach the device.
    void lane.schedule(42);

    await ran;
    expect(writes).toEqual([42]);
  });

  it("applies the newest queued value after an older in-flight write completes", async () => {
    let releaseFirst!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writes: number[] = [];
    let runCount = 0;
    const lane = createLatestIntentWriteLane<number>({
      run: async (value) => {
        runCount += 1;
        writes.push(value);
        if (runCount === 1) {
          await firstRunDone;
        }
      },
    });

    const first = lane.schedule(1);
    const second = lane.schedule(2);

    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);

    expect(writes).toEqual([1, 2]);
  });

  it("settles a sustained slider-like burst with the first write plus the final intent only", async () => {
    let releaseFirst!: () => void;
    const firstRunDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writes: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const lane = createLatestIntentWriteLane<number>({
      run: async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        writes.push(value);
        if (value === 1) {
          await firstRunDone;
        }
        inFlight -= 1;
      },
    });

    const scheduled = [lane.schedule(1)];
    await Promise.resolve();
    for (let value = 2; value <= 20; value += 1) {
      scheduled.push(lane.schedule(value));
    }

    releaseFirst();
    await Promise.all(scheduled);

    expect(writes).toEqual([1, 20]);
    expect(maxInFlight).toBe(1);
  });

  it("merges every value scheduled while an earlier job is in flight (HARD9-016)", async () => {
    // Three overlapping schedule() calls with distinct keys, all landing
    // while the first job is still stuck in beforeRun(): job2 and job3 must
    // both be preserved (via schedule()'s own merge, since only one of them
    // is ever the "next queued job" at a time), not just the last one.
    let allowRuns = false;
    const writes: Array<Record<string, number>> = [];
    const lane = createLatestIntentWriteLane<Record<string, number>>({
      beforeRun: async () => {
        while (!allowRuns) {
          await Promise.resolve();
        }
      },
      run: async (value) => {
        writes.push(value);
      },
      merge: (previous, next) => ({ ...previous, ...next }),
    });

    const volumeWrite = lane.schedule({ sid1_volume: 15 });
    const panWrite = lane.schedule({ sid1_pan: 8 });
    const addressWrite = lane.schedule({ sid2_volume: 3 });

    allowRuns = true;
    await Promise.all([volumeWrite, panWrite, addressWrite]);

    expect(writes).toEqual([{ sid1_volume: 15, sid1_pan: 8, sid2_volume: 3 }]);
  });

  it("rejects the settled write when no newer value supersedes a failure", async () => {
    const lane = createLatestIntentWriteLane<number>({
      run: async () => {
        throw new Error("write failed");
      },
    });

    await expect(lane.schedule(1)).rejects.toThrow("write failed");
  });

  it("merges a still-pending value with a newly scheduled one when merge is provided (HARD9-016)", async () => {
    // Regression: a shared lane (e.g. all 8 SID sliders behind one
    // useInteractiveConfigWrite) replaced the pending job outright, so
    // committing item A's write while item B's write was still pending
    // silently discarded B - and resolveUpTo() still resolved B's waiter as
    // a success once A's run() completed, so nobody ever saw an error.
    let allowRuns = false;
    const writes: Array<Record<string, number>> = [];
    const lane = createLatestIntentWriteLane<Record<string, number>>({
      beforeRun: async () => {
        while (!allowRuns) {
          await Promise.resolve();
        }
      },
      run: async (value) => {
        writes.push(value);
      },
      merge: (previous, next) => ({ ...previous, ...next }),
    });

    const volumeWrite = lane.schedule({ sid1_volume: 15 });
    const panWrite = lane.schedule({ sid1_pan: 8 });

    allowRuns = true;
    await Promise.all([volumeWrite, panWrite]);

    expect(writes).toEqual([{ sid1_volume: 15, sid1_pan: 8 }]);
  });

  it("lets a later merge overwrite the same key while preserving other pending keys (HARD9-016)", async () => {
    let allowRuns = false;
    const writes: Array<Record<string, number>> = [];
    const lane = createLatestIntentWriteLane<Record<string, number>>({
      beforeRun: async () => {
        while (!allowRuns) {
          await Promise.resolve();
        }
      },
      run: async (value) => {
        writes.push(value);
      },
      merge: (previous, next) => ({ ...previous, ...next }),
    });

    const first = lane.schedule({ sid1_volume: 15, sid1_pan: 8 });
    const second = lane.schedule({ sid1_volume: 20 });

    allowRuns = true;
    await Promise.all([first, second]);

    expect(writes).toEqual([{ sid1_volume: 20, sid1_pan: 8 }]);
  });

  it("resolves superseded waiters when only the final effective write fails", async () => {
    let allowRuns = false;
    const lane = createLatestIntentWriteLane<number>({
      beforeRun: async () => {
        while (!allowRuns) {
          await Promise.resolve();
        }
      },
      run: async (value) => {
        if (value === 2) {
          throw new Error("final write failed");
        }
      },
    });

    const superseded = lane.schedule(1);
    const final = lane.schedule(2);

    allowRuns = true;

    await expect(superseded).resolves.toBeUndefined();
    await expect(final).rejects.toThrow("final write failed");
  });

  it("merges a failed job's value into the superseding job instead of discarding it (HARD9-016)", async () => {
    const writes: Array<Record<string, number>> = [];
    let releaseFirstRun!: () => void;
    const firstRunReleased = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    let attempt = 0;
    const lane = createLatestIntentWriteLane<Record<string, number>>({
      run: async (value) => {
        attempt += 1;
        writes.push(value);
        if (attempt === 1) {
          await firstRunReleased;
          throw new Error("device rejected write");
        }
      },
      merge: (previous, next) => ({ ...previous, ...next }),
    });

    // job1 is taken and its run() has already pushed its write, suspended on
    // firstRunReleased, before job2 is scheduled - so job2 lands in
    // latestJob while job1 is still (about to be) failing.
    const first = lane.schedule({ sid1_volume: 15 });
    const second = lane.schedule({ sid1_pan: 8 });
    releaseFirstRun();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(writes[1]).toEqual({ sid1_volume: 15, sid1_pan: 8 });
  });

  it("HARD12-010: rejects both folded-in waiters when a merge-lane run fails with no superseding job", async () => {
    // Without merge, the previous waiter (v1) was silently resolved as a
    // success — its value had been merged into the failing v2 batch, so
    // resolveUpTo(v1) lied. The merge lane must now reject every waiter
    // whose value was folded into the failed batch.
    let allowRuns = false;
    const lane = createLatestIntentWriteLane<Record<string, number>>({
      beforeRun: async () => {
        while (!allowRuns) {
          await Promise.resolve();
        }
      },
      run: async () => {
        throw new Error("device rejected merged write");
      },
      merge: (previous, next) => ({ ...previous, ...next }),
    });

    const volumeWrite = lane.schedule({ sid1_volume: 15 });
    const panWrite = lane.schedule({ sid1_pan: 8 });
    allowRuns = true;

    await expect(volumeWrite).rejects.toThrow("device rejected merged write");
    await expect(panWrite).rejects.toThrow("device rejected merged write");
  });

  it("HARD12-010: keeps resolve-superseded-as-success for non-merge lanes when the final write fails", async () => {
    // Sanity check that the change is scoped to merge lanes — replace-
    // semantics lanes must keep their historical behaviour where superseded
    // waiters were never sent and therefore resolve as success.
    let allowRuns = false;
    const lane = createLatestIntentWriteLane<number>({
      beforeRun: async () => {
        while (!allowRuns) {
          await Promise.resolve();
        }
      },
      run: async (value) => {
        if (value === 2) {
          throw new Error("final write failed");
        }
      },
    });

    const superseded = lane.schedule(1);
    const final = lane.schedule(2);
    allowRuns = true;

    await expect(superseded).resolves.toBeUndefined();
    await expect(final).rejects.toThrow("final write failed");
  });
});

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

  it("rejects the settled write when no newer value supersedes a failure", async () => {
    const lane = createLatestIntentWriteLane<number>({
      run: async () => {
        throw new Error("write failed");
      },
    });

    await expect(lane.schedule(1)).rejects.toThrow("write failed");
  });
});

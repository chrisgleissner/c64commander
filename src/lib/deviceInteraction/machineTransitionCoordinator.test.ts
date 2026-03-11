/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  createMachineTransitionCoordinator,
  SupersededMachineTransitionError,
} from "@/lib/deviceInteraction/machineTransitionCoordinator";

describe("createMachineTransitionCoordinator", () => {
  it("coalesces repeated requests for the same target while one is active", async () => {
    const coordinator = createMachineTransitionCoordinator();
    let releasePause!: () => void;
    const pauseBlocked = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let runs = 0;

    const first = coordinator.request("paused", async () => {
      runs += 1;
      await pauseBlocked;
    });
    const second = coordinator.request("paused", async () => {
      runs += 1;
    });

    releasePause();
    await Promise.all([first, second]);

    expect(runs).toBe(1);
  });

  it("keeps only the latest queued target when pause and resume requests burst", async () => {
    const coordinator = createMachineTransitionCoordinator();
    let releasePause!: () => void;
    const pauseBlocked = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    const order: string[] = [];

    const pause = coordinator.request("paused", async () => {
      order.push("pause");
      await pauseBlocked;
    });
    const resume = coordinator.request("running", async () => {
      order.push("resume");
    });
    const finalPause = coordinator.request("paused", async () => {
      order.push("pause-final");
    });

    releasePause();

    await expect(resume).rejects.toBeInstanceOf(SupersededMachineTransitionError);
    await Promise.all([pause, finalPause]);

    expect(order).toEqual(["pause", "pause-final"]);
  });
});

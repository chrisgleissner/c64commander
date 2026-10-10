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

  it("ends a pause, resume, pause burst with the one pause under way, not a second pause", async () => {
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

    expect(order).toEqual(["pause"]);
  });

  it("keeps only the latest queued target when requests burst behind another target", async () => {
    const coordinator = createMachineTransitionCoordinator();
    let releaseResume!: () => void;
    const resumeBlocked = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    const order: string[] = [];

    const resume = coordinator.request("running", async () => {
      order.push("resume");
      await resumeBlocked;
    });
    const pause = coordinator.request("paused", async () => {
      order.push("pause");
    });
    const secondPause = coordinator.request("paused", async () => {
      order.push("pause-again");
    });

    releaseResume();
    await Promise.all([resume, pause, secondPause]);

    expect(order).toEqual(["resume", "pause"]);
  });
});

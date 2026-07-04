/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { serializeMachineInputRequest, serializeNativeDeviceRequest } from "@/lib/c64api";

/**
 * HARD13: the machine-input relay runs on a dedicated single-slot lane that is
 * independent of the shared bulk-REST concurrency semaphore, so slow polling
 * (config/drive/info) can never starve the >=10/sec input relay.
 */
describe("machine input lane", () => {
  it("is not blocked when the shared bulk-REST lane is fully occupied", async () => {
    let releaseBulk: (() => void) | undefined;
    const bulkGate = new Promise<void>((resolve) => {
      releaseBulk = resolve;
    });
    // Occupy the single shared bulk slot with a request that will not resolve yet.
    const bulkPromise = serializeNativeDeviceRequest(() => bulkGate, 1);
    await Promise.resolve();

    // The input-lane request must run to completion despite the bulk lane being busy.
    let inputRan = false;
    const inputResult = await serializeMachineInputRequest(async () => {
      inputRan = true;
      return "relayed";
    });

    expect(inputRan).toBe(true);
    expect(inputResult).toBe("relayed");

    releaseBulk?.();
    await bulkPromise;
  });

  it("serializes input requests to one in flight at a time (bounded device connections)", async () => {
    let active = 0;
    let maxActive = 0;
    const gates: Array<() => void> = [];
    const task = () =>
      serializeMachineInputRequest(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => gates.push(resolve));
        active -= 1;
      });

    const promises = [task(), task(), task()];

    // Release one at a time: each release lets the next queued task start, which
    // registers the next gate. Only one task body may ever be active at once.
    for (let i = 0; i < promises.length; i += 1) {
      for (let tick = 0; tick < 50 && gates.length < i + 1; tick += 1) await Promise.resolve();
      gates[i]?.();
    }
    await Promise.all(promises);

    expect(maxActive).toBe(1);
  });
});

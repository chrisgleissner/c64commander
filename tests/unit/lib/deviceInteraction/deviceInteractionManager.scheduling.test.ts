/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beginMachineTransition, resetDeviceActivityGate } from "@/lib/deviceInteraction/deviceActivityGate";
import { updateDeviceConnectionState } from "@/lib/deviceInteraction/deviceStateStore";
import { resetInteractionState, withRestInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";

const action = {} as any;

describe("withRestInteraction", () => {
  beforeEach(() => {
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
    updateDeviceConnectionState("REAL_CONNECTED");
    resetDeviceActivityGate();
    resetInteractionState("test");
  });

  afterEach(() => {
    delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    resetDeviceActivityGate();
    resetInteractionState("test-cleanup");
  });

  it("serializes overlapping machine and config mutations for the same device", async () => {
    let activeMutations = 0;
    let maxActiveMutations = 0;
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = withRestInteraction(
      {
        action,
        method: "PUT",
        path: "/v1/machine:pause",
        normalizedUrl: "/v1/machine:pause",
        intent: "user",
        baseUrl: "http://c64u",
      },
      async () => {
        order.push("first-start");
        activeMutations += 1;
        maxActiveMutations = Math.max(maxActiveMutations, activeMutations);
        await firstDone;
        activeMutations -= 1;
        order.push("first-end");
        return "first";
      },
    );

    const second = withRestInteraction(
      {
        action,
        method: "POST",
        path: "/v1/configs",
        normalizedUrl: "/v1/configs",
        intent: "user",
        baseUrl: "http://c64u",
      },
      async () => {
        order.push("second-start");
        activeMutations += 1;
        maxActiveMutations = Math.max(maxActiveMutations, activeMutations);
        activeMutations -= 1;
        order.push("second-end");
        return "second";
      },
    );

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(maxActiveMutations).toBe(1);
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("defers background reads until the machine transition window settles", async () => {
    const endTransition = beginMachineTransition();
    const events: string[] = [];

    const request = withRestInteraction(
      {
        action,
        method: "GET",
        path: "/v1/configs",
        normalizedUrl: "/v1/configs",
        intent: "background",
        baseUrl: "http://c64u",
      },
      async () => {
        events.push("read-started");
        return "ok";
      },
    );

    await Promise.resolve();
    expect(events).toEqual([]);

    endTransition();
    await request;

    expect(events).toEqual(["read-started"]);
  });
});

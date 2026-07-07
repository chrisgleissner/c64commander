/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginInteractiveWriteBurst,
  beginMachineTransition,
  resetDeviceActivityGate,
} from "@/lib/deviceInteraction/deviceActivityGate";
import { updateDeviceConnectionState } from "@/lib/deviceInteraction/deviceStateStore";
import {
  resetInteractionState,
  withRestInteraction,
  withTelnetInteraction,
} from "@/lib/deviceInteraction/deviceInteractionManager";
import { saveDeviceSafetyMode } from "@/lib/config/deviceSafetySettings";

const action = {} as any;

describe("withRestInteraction", () => {
  beforeEach(() => {
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
    localStorage.clear();
    saveDeviceSafetyMode("BALANCED");
    updateDeviceConnectionState("REAL_CONNECTED");
    resetDeviceActivityGate();
    resetInteractionState("test");
  });

  afterEach(() => {
    delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    resetDeviceActivityGate();
    resetInteractionState("test-cleanup");
    localStorage.clear();
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

  it("defers system health reads while a user write burst is active", async () => {
    vi.useFakeTimers();
    const endBurst = beginInteractiveWriteBurst(250);
    const events: string[] = [];

    try {
      const systemRead = withRestInteraction(
        {
          action,
          method: "GET",
          path: "/v1/info",
          normalizedUrl: "/v1/info",
          intent: "system",
          baseUrl: "http://c64u",
          bypassBackoff: true,
          bypassCooldown: true,
        },
        async () => {
          events.push("system-read-started");
          return "ok";
        },
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(events).toEqual([]);

      endBurst();
      await vi.advanceTimersByTimeAsync(250);
      await systemRead;

      expect(events).toEqual(["system-read-started"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies Device Safety config cooldown between config mutations", async () => {
    vi.useFakeTimers();
    const events: Array<{ label: string; at: number }> = [];

    try {
      const first = withRestInteraction(
        {
          action,
          method: "POST",
          path: "/v1/configs",
          normalizedUrl: "/v1/configs",
          intent: "user",
          baseUrl: "http://c64u",
        },
        async () => {
          events.push({ label: "first", at: Date.now() });
          return "first";
        },
      );

      await vi.runOnlyPendingTimersAsync();
      await first;
      await vi.advanceTimersByTimeAsync(0);

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
          events.push({ label: "second", at: Date.now() });
          return "second";
        },
      );

      await vi.advanceTimersByTimeAsync(499);
      expect(events.map((event) => event.label)).toEqual(["first"]);

      await vi.advanceTimersByTimeAsync(1);
      await second;

      expect(events.map((event) => event.label)).toEqual(["first", "second"]);
      expect(events[1].at - events[0].at).toBeGreaterThanOrEqual(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies Device Safety info cooldown to failed system probes", async () => {
    vi.useFakeTimers();
    const events: Array<{ label: string; at: number }> = [];

    try {
      const first = withRestInteraction(
        {
          action,
          method: "GET",
          path: "/v1/info",
          normalizedUrl: "/v1/info",
          intent: "system",
          baseUrl: "http://c64u",
          bypassCache: true,
          allowDuringError: true,
          bypassCircuit: true,
        },
        async () => {
          events.push({ label: "first", at: Date.now() });
          throw new Error("Host unreachable");
        },
      );
      void first.catch(() => undefined);

      await vi.runOnlyPendingTimersAsync();
      await expect(first).rejects.toThrow("Host unreachable");
      await vi.advanceTimersByTimeAsync(0);

      const second = withRestInteraction(
        {
          action,
          method: "GET",
          path: "/v1/info",
          normalizedUrl: "/v1/info",
          intent: "system",
          baseUrl: "http://c64u",
          bypassCache: true,
          allowDuringError: true,
          bypassCircuit: true,
        },
        async () => {
          events.push({ label: "second", at: Date.now() });
          return "second";
        },
      );

      await vi.advanceTimersByTimeAsync(599);
      expect(events.map((event) => event.label)).toEqual(["first"]);

      await vi.advanceTimersByTimeAsync(1);
      await second;

      expect(events.map((event) => event.label)).toEqual(["first", "second"]);
      expect(events[1].at - events[0].at).toBeGreaterThanOrEqual(600);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces rapid machine read requests behind the machine-io cooldown", async () => {
    vi.useFakeTimers();
    const events: Array<{ label: string; at: number }> = [];

    try {
      const first = withRestInteraction(
        {
          action,
          method: "GET",
          path: "/v1/machine:readmem?address=00A2&length=3",
          normalizedUrl: "/v1/machine:readmem",
          intent: "system",
          baseUrl: "http://c64u",
          bypassCache: true,
        },
        async () => {
          events.push({ label: "first", at: Date.now() });
          return "first";
        },
      );

      await vi.runOnlyPendingTimersAsync();
      await first;
      await vi.advanceTimersByTimeAsync(0);

      const second = withRestInteraction(
        {
          action,
          method: "GET",
          path: "/v1/machine:readmem?address=00A2&length=3",
          normalizedUrl: "/v1/machine:readmem",
          intent: "system",
          baseUrl: "http://c64u",
          bypassCache: true,
        },
        async () => {
          events.push({ label: "second", at: Date.now() });
          return "second";
        },
      );

      await vi.advanceTimersByTimeAsync(249);
      expect(events.map((event) => event.label)).toEqual(["first"]);

      await vi.advanceTimersByTimeAsync(1);
      await second;

      expect(events.map((event) => event.label)).toEqual(["first", "second"]);
      expect(events[1].at - events[0].at).toBeGreaterThanOrEqual(250);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces rapid machine write requests behind the machine-io cooldown", async () => {
    vi.useFakeTimers();
    const events: Array<{ label: string; at: number }> = [];

    try {
      const first = withRestInteraction(
        {
          action,
          method: "PUT",
          path: "/v1/machine:writemem?address=1000",
          normalizedUrl: "/v1/machine:writemem",
          intent: "user",
          baseUrl: "http://c64u",
        },
        async () => {
          events.push({ label: "first", at: Date.now() });
          return "first";
        },
      );

      await vi.runOnlyPendingTimersAsync();
      await first;
      await vi.advanceTimersByTimeAsync(0);

      const second = withRestInteraction(
        {
          action,
          method: "PUT",
          path: "/v1/machine:writemem?address=1000",
          normalizedUrl: "/v1/machine:writemem",
          intent: "user",
          baseUrl: "http://c64u",
        },
        async () => {
          events.push({ label: "second", at: Date.now() });
          return "second";
        },
      );

      await vi.advanceTimersByTimeAsync(249);
      expect(events.map((event) => event.label)).toEqual(["first"]);

      await vi.advanceTimersByTimeAsync(1);
      await second;

      expect(events.map((event) => event.label)).toEqual(["first", "second"]);
      expect(events[1].at - events[0].at).toBeGreaterThanOrEqual(250);
    } finally {
      vi.useRealTimers();
    }
  });

  it("HARD18-005: input-lane requests bypass the bulk single-slot scheduler", async () => {
    let releaseBulk!: () => void;
    const bulkDone = new Promise<void>((resolve) => {
      releaseBulk = resolve;
    });
    const order: string[] = [];

    const bulk = withRestInteraction(
      {
        action,
        method: "PUT",
        path: "/v1/drives/a:mount",
        normalizedUrl: "/v1/drives/a:mount",
        intent: "user",
        baseUrl: "http://c64u",
      },
      async () => {
        order.push("bulk-start");
        await bulkDone;
        order.push("bulk-end");
        return "bulk";
      },
    );

    await Promise.resolve();
    expect(order).toEqual(["bulk-start"]);

    const inputLane = withRestInteraction(
      {
        action,
        method: "POST",
        path: "/v1/machine:input",
        normalizedUrl: "/v1/machine:input",
        intent: "user",
        baseUrl: "http://c64u",
        bypassCircuit: true,
        bypassBackoff: true,
        bypassCooldown: true,
        useInputLane: true,
      },
      async () => {
        order.push("input-start");
        return "input";
      },
    );

    await inputLane;
    expect(order).toEqual(["bulk-start", "input-start"]);

    releaseBulk();
    await bulk;
    expect(order).toEqual(["bulk-start", "input-start", "bulk-end"]);
  });

  it("applies Device Safety Telnet connect cooldown between sessions for the same host", async () => {
    vi.useFakeTimers();
    const events: Array<{ label: string; at: number }> = [];

    try {
      const first = withTelnetInteraction(
        {
          action,
          actionId: "first-telnet",
          intent: "system",
          host: "c64u",
          port: 23,
        },
        async () => {
          events.push({ label: "first", at: Date.now() });
          return "first";
        },
      );

      await vi.runOnlyPendingTimersAsync();
      await first;
      await vi.advanceTimersByTimeAsync(0);

      const second = withTelnetInteraction(
        {
          action,
          actionId: "second-telnet",
          intent: "system",
          host: "c64u",
          port: 23,
        },
        async () => {
          events.push({ label: "second", at: Date.now() });
          return "second";
        },
      );

      await vi.advanceTimersByTimeAsync(299);
      expect(events.map((event) => event.label)).toEqual(["first"]);

      await vi.advanceTimersByTimeAsync(1);
      await second;

      expect(events.map((event) => event.label)).toEqual(["first", "second"]);
      expect(events[1].at - events[0].at).toBeGreaterThanOrEqual(300);
    } finally {
      vi.useRealTimers();
    }
  });
});

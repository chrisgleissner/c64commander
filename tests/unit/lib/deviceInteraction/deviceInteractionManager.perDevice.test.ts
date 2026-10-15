/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDeviceActivityGate } from "@/lib/deviceInteraction/deviceActivityGate";
import { updateDeviceConnectionState } from "@/lib/deviceInteraction/deviceStateStore";
import {
  InteractionCancelledError,
  resetInteractionState,
  withFtpInteraction,
  withRestInteraction,
  withTelnetInteraction,
  type InteractionIntent,
} from "@/lib/deviceInteraction/deviceInteractionManager";
import { saveDeviceSafetyMode } from "@/lib/config/deviceSafetySettings";

const action = {} as any;

const flushTimersAndMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const pendingReleases: Array<() => void> = [];

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingReleases.push(release);
  return { promise, release };
};

const request = (
  target: { baseUrl: string; deviceHost?: string },
  intent: InteractionIntent,
  path: string,
  handler: () => Promise<string>,
) =>
  withRestInteraction(
    {
      action,
      method: "GET",
      path,
      normalizedUrl: path,
      intent,
      baseUrl: target.baseUrl,
      deviceHost: target.deviceHost,
      allowDuringError: true,
      bypassCache: true,
      bypassCooldown: true,
    },
    handler,
  );

describe("withRestInteraction per-device REST slot", () => {
  beforeEach(() => {
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
    localStorage.clear();
    saveDeviceSafetyMode("BALANCED");
    updateDeviceConnectionState("REAL_CONNECTED");
    resetDeviceActivityGate();
    resetInteractionState("test");
  });

  afterEach(async () => {
    pendingReleases.splice(0).forEach((release) => release());
    await flushTimersAndMicrotasks();
    delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    resetDeviceActivityGate();
    resetInteractionState("test-cleanup");
    localStorage.clear();
  });

  it("does not hold a reachable device's readMemory behind a device that does not answer", async () => {
    const unreachable = deferred();
    const events: string[] = [];
    const unreachableInfo = request({ baseUrl: "http://u2" }, "system", "/v1/info", async () => {
      events.push("u2-info-start");
      await unreachable.promise;
      return "u2";
    });
    const raster = request(
      { baseUrl: "http://c64u" },
      "system",
      "/v1/machine:readmem?address=D012&length=1",
      async () => {
        events.push("c64u-readmem-start");
        return "c64u";
      },
    );

    await flushTimersAndMicrotasks();

    expect(events).toEqual(["u2-info-start", "c64u-readmem-start"]);
    await expect(raster).resolves.toBe("c64u");
    unreachable.release();
    await expect(unreachableInfo).resolves.toBe("u2");
  });

  it("keeps devices behind one web proxy apart by their device host", async () => {
    const unreachable = deferred();
    const events: string[] = [];
    const proxy = "http://localhost:8064/api/rest";
    const unreachableInfo = request({ baseUrl: proxy, deviceHost: "u2" }, "system", "/v1/info", async () => {
      events.push("u2-start");
      await unreachable.promise;
      return "u2";
    });
    const reachableInfo = request({ baseUrl: proxy, deviceHost: "c64u" }, "system", "/v1/info", async () => {
      events.push("c64u-start");
      return "c64u";
    });

    await flushTimersAndMicrotasks();

    expect(events).toEqual(["u2-start", "c64u-start"]);
    await expect(reachableInfo).resolves.toBe("c64u");
    unreachable.release();
    await unreachableInfo;
  });

  it("keeps the readMemory cooldown of devices behind one web proxy apart", async () => {
    const proxy = "http://localhost:8064/api/rest";
    const events: string[] = [];
    const readMemory = (deviceHost: string, label: string) =>
      withRestInteraction(
        {
          action,
          method: "GET",
          path: "/v1/machine:readmem?address=D012&length=1",
          normalizedUrl: "/v1/machine:readmem",
          intent: "system",
          baseUrl: proxy,
          deviceHost,
        },
        async () => {
          events.push(label);
          return label;
        },
      );

    await readMemory("u2", "u2-first");
    const otherDevice = readMemory("c64u", "c64u-first");
    const sameDevice = readMemory("u2", "u2-second");
    await flushTimersAndMicrotasks();

    expect(events).toEqual(["u2-first", "c64u-first"]);
    await expect(otherDevice).resolves.toBe("c64u-first");
    await expect(sameDevice).resolves.toBe("u2-second");
  });

  it("serializes requests to one host even when they use different ports or letter case", async () => {
    const first = deferred();
    const events: string[] = [];
    const firstRequest = request({ baseUrl: "http://c64u" }, "user", "/v1/info", async () => {
      events.push("first-start");
      await first.promise;
      events.push("first-end");
      return "first";
    });
    const secondRequest = request({ baseUrl: "http://C64U:8080" }, "user", "/v1/drives", async () => {
      events.push("second-start");
      return "second";
    });

    await flushTimersAndMicrotasks();
    expect(events).toEqual(["first-start"]);

    first.release();
    await Promise.all([firstRequest, secondRequest]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("orders each device's queue user before system before background while another device runs freely", async () => {
    const holder = deferred();
    const order: string[] = [];
    const record = (label: string) => async () => {
      order.push(label);
      return label;
    };
    const holding = request({ baseUrl: "http://c64u" }, "user", "/v1/info", async () => {
      order.push("c64u-holder");
      await holder.promise;
      return "holder";
    });
    await flushTimersAndMicrotasks();

    const queued = [
      request({ baseUrl: "http://c64u" }, "background", "/v1/drives", record("c64u-background")),
      request({ baseUrl: "http://c64u" }, "system", "/v1/configs", record("c64u-system")),
      request({ baseUrl: "http://c64u" }, "user", "/v1/version", record("c64u-user")),
    ];
    const otherDevice = request({ baseUrl: "http://u2" }, "background", "/v1/info", record("u2-background"));

    await expect(otherDevice).resolves.toBe("u2-background");
    expect(order).toEqual(["c64u-holder", "u2-background"]);

    holder.release();
    await Promise.all([holding, ...queued]);
    expect(order).toEqual(["c64u-holder", "u2-background", "c64u-user", "c64u-system", "c64u-background"]);
  });

  it("cancels the queued requests of every device on an interaction reset", async () => {
    const c64uHolder = deferred();
    const u2Holder = deferred();
    const c64uRunning = request({ baseUrl: "http://c64u" }, "system", "/v1/info", async () => {
      await c64uHolder.promise;
      return "c64u-running";
    });
    const u2Running = request({ baseUrl: "http://u2" }, "system", "/v1/info", async () => {
      await u2Holder.promise;
      return "u2-running";
    });
    await flushTimersAndMicrotasks();
    const c64uQueued = request({ baseUrl: "http://c64u" }, "system", "/v1/drives", async () => "c64u-queued");
    const u2Queued = request({ baseUrl: "http://u2" }, "system", "/v1/drives", async () => "u2-queued");

    resetInteractionState("saved-device-switch");

    await expect(c64uQueued).rejects.toBeInstanceOf(InteractionCancelledError);
    await expect(u2Queued).rejects.toBeInstanceOf(InteractionCancelledError);
    c64uHolder.release();
    u2Holder.release();
    await expect(c64uRunning).resolves.toBe("c64u-running");
    await expect(u2Running).resolves.toBe("u2-running");
  });

  it.each([
    [
      "FTP",
      (host: string, handler: () => Promise<string>) =>
        withFtpInteraction({ action, operation: "ping", path: "/", intent: "system", host, port: 21 }, handler),
    ],
    [
      "Telnet",
      (host: string, handler: () => Promise<string>) =>
        withTelnetInteraction({ action, actionId: "probe", intent: "system", host, port: 23 }, handler),
    ],
  ])("does not hold a reachable device's %s session behind a device that does not answer", async (_, interact) => {
    saveDeviceSafetyMode("CONSERVATIVE");
    resetInteractionState("conservative");
    const unreachable = deferred();
    const events: string[] = [];
    const unreachableSession = interact("u2", async () => {
      events.push("u2-start");
      await unreachable.promise;
      return "u2";
    });
    const reachableSession = interact("c64u", async () => {
      events.push("c64u-start");
      return "c64u";
    });

    await flushTimersAndMicrotasks();

    expect(events).toEqual(["u2-start", "c64u-start"]);
    await expect(reachableSession).resolves.toBe("c64u");
    unreachable.release();
    await expect(unreachableSession).resolves.toBe("u2");
  });
});

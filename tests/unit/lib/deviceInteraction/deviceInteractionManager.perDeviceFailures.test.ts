/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDeviceActivityGate } from "@/lib/deviceInteraction/deviceActivityGate";
import { getDeviceStateSnapshot, updateDeviceConnectionState } from "@/lib/deviceInteraction/deviceStateStore";
import {
  resetInteractionState,
  withFtpInteraction,
  withRestInteraction,
  withTelnetInteraction,
} from "@/lib/deviceInteraction/deviceInteractionManager";
import { registerSavedDevicesForDeviceScope } from "@/lib/deviceInteraction/deviceScope";
import { saveDeviceSafetyMode } from "@/lib/config/deviceSafetySettings";
import type { SavedDevice } from "@/lib/savedDevices/store";

const action = {} as any;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const pendingReleases: Array<() => void> = [];
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingReleases.push(release);
  return { promise, release };
};

const rest = (
  target: { baseUrl: string; deviceHost?: string },
  path: string,
  handler: () => Promise<string>,
  extra: Partial<Parameters<typeof withRestInteraction>[0]> = {},
) =>
  withRestInteraction(
    {
      action,
      method: "GET",
      path,
      normalizedUrl: path,
      intent: "user",
      baseUrl: target.baseUrl,
      deviceHost: target.deviceHost,
      bypassCooldown: true,
      bypassCache: true,
      ...extra,
    },
    handler,
  );

const failWithTimeout = async (): Promise<string> => {
  throw Object.assign(new Error("Request timed out"), { c64uRestFailureKind: "network" });
};

const sameMachineSavedTwice = () => {
  const entry = (id: string, host: string) =>
    ({ id, host, lastKnownUniqueId: "8D927F", lastKnownHostname: "c64u-8d927f" }) as SavedDevice;
  const snapshot = {
    devices: [entry("ethernet", "192.168.1.13"), entry("wifi", "192.168.1.48")],
    verifiedByDeviceId: {},
  };
  registerSavedDevicesForDeviceScope(() => snapshot);
};

describe("device interaction state per device", () => {
  beforeEach(() => {
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
    localStorage.clear();
    saveDeviceSafetyMode("CONSERVATIVE");
    updateDeviceConnectionState("REAL_CONNECTED");
    resetDeviceActivityGate();
    resetInteractionState("test");
  });

  afterEach(async () => {
    pendingReleases.splice(0).forEach((release) => release());
    await flush();
    registerSavedDevicesForDeviceScope(null);
    delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    resetDeviceActivityGate();
    resetInteractionState("test-cleanup");
    localStorage.clear();
  });

  it("serializes the REST, FTP and Telnet requests of one Ultimate saved under its Ethernet and Wi-Fi addresses", async () => {
    sameMachineSavedTwice();
    const events: string[] = [];
    const running = deferred();
    const restHeld = rest({ baseUrl: "http://192.168.1.13" }, "/v1/info", async () => {
      events.push("rest-ethernet");
      await running.promise;
      return "ethernet";
    });
    const restSecond = rest({ baseUrl: "http://192.168.1.48" }, "/v1/drives", async () => {
      events.push("rest-wifi");
      return "wifi";
    });
    const ftpHeld = withFtpInteraction(
      { action, operation: "ping", path: "/", intent: "system", host: "192.168.1.13", port: 21 },
      async () => {
        events.push("ftp-ethernet");
        await running.promise;
        return "ftp-ethernet";
      },
    );
    const ftpSecond = withFtpInteraction(
      { action, operation: "ping", path: "/", intent: "system", host: "192.168.1.48", port: 21 },
      async () => {
        events.push("ftp-wifi");
        return "ftp-wifi";
      },
    );
    const telnetHeld = withTelnetInteraction(
      { action, actionId: "a", intent: "system", host: "192.168.1.13", port: 23 },
      async () => {
        events.push("telnet-ethernet");
        await running.promise;
        return "telnet-ethernet";
      },
    );
    const telnetSecond = withTelnetInteraction(
      { action, actionId: "b", intent: "system", host: "192.168.1.48", port: 23 },
      async () => {
        events.push("telnet-wifi");
        return "telnet-wifi";
      },
    );
    await flush();

    expect(events).toEqual(["rest-ethernet", "ftp-ethernet", "telnet-ethernet"]);
    running.release();
    await Promise.all([restHeld, restSecond, ftpHeld, ftpSecond, telnetHeld, telnetSecond]);
    expect(events).toHaveLength(6);
  });

  it("does not delay another device while the first one is backing off after failures", async () => {
    await expect(rest({ baseUrl: "http://c64u" }, "/v1/info", failWithTimeout)).rejects.toThrow("timed out");
    const events: string[] = [];
    const other = rest({ baseUrl: "http://u2" }, "/v1/info", async () => {
      events.push("u2");
      return "u2";
    });
    await flush();

    expect(events).toEqual(["u2"]);
    await expect(other).resolves.toBe("u2");
  });

  it("keeps a device's circuit open when another device answers", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        rest({ baseUrl: "http://c64u" }, "/v1/info", failWithTimeout, { intent: "system", bypassBackoff: true }),
      ).rejects.toThrow("timed out");
    }
    expect(getDeviceStateSnapshot().circuitOpenUntilMs).not.toBeNull();

    await expect(rest({ baseUrl: "http://u2" }, "/v1/info", async () => "u2")).resolves.toBe("u2");

    expect(getDeviceStateSnapshot().circuitOpenUntilMs).not.toBeNull();
    await expect(
      rest({ baseUrl: "http://c64u" }, "/v1/drives", async () => "c64u", { intent: "system", allowDuringError: true }),
    ).rejects.toThrow("Device circuit open");
  });

  it("keeps the cached /v1/info of two devices behind one web proxy apart", async () => {
    const proxy = "http://localhost:8064/api/rest";
    const info = (deviceHost: string) =>
      rest({ baseUrl: proxy, deviceHost }, "/v1/info", async () => deviceHost, { bypassCache: false });

    await expect(info("c64u")).resolves.toBe("c64u");
    await expect(info("u2")).resolves.toBe("u2");
    await expect(info("c64u")).resolves.toBe("c64u");
  });
});

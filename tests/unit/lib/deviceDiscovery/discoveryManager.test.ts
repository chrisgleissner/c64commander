/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceDiscoveryCandidate } from "@/lib/deviceDiscovery/types";

const discover = vi.fn();

vi.mock("@/lib/native/deviceDiscovery", () => ({
  DeviceDiscovery: {
    discover,
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details: Record<string, unknown> = {}) => ({
    ...details,
    error: { name: error.name, message: error.message, stack: error.stack },
    errorName: error.name,
    errorStack: error.stack ?? null,
  })),
}));

describe("device discovery manager", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    discover.mockReset();
  });

  it("normalizes verified Ultimate candidates and dedupes by unique id", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        {
          address: "192.168.1.13",
          host: "u64",
          httpPort: 80,
          source: ["hostname"],
          product: "Ultimate 64 Elite",
          firmwareVersion: "3.14e",
          fpgaVersion: "122",
          coreVersion: "1.4B",
          hostname: "u64",
          uniqueId: "38C1BA",
        },
        {
          address: "192.168.1.13",
          httpPort: 80,
          source: ["lan-scan"],
          product: "Ultimate 64 Elite",
          firmwareVersion: "3.14e",
          fpgaVersion: "122",
          coreVersion: "1.4B",
          hostname: "u64",
          uniqueId: "38C1BA",
        },
        {
          address: "192.168.1.20",
          httpPort: 80,
          source: ["lan-scan"],
          product: "Printer",
        },
      ],
      scannedHosts: 254,
      elapsedMs: 120,
      unsupported: false,
    });

    const { getDeviceDiscoveryState, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true, timeoutMs: 10_000 });

    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({
        includeLanScan: true,
        timeoutMs: 10_000,
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      address: "192.168.1.13",
      product: "Ultimate 64 Elite",
      hostname: "u64",
      uniqueId: "38C1BA",
      requiresPassword: false,
      source: ["hostname", "lan-scan"],
      confidence: "verified",
    });
    expect(getDeviceDiscoveryState()).toMatchObject({
      phase: "complete",
      scannedHosts: 254,
      candidates: result.candidates,
    });
  });

  it("persists a discovered device as a selected saved device with verified identity", async () => {
    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");

    const persisted = persistDiscoveredDevice(
      {
        id: "id:5d4e12",
        address: "192.168.1.167",
        host: null,
        httpPort: 80,
        source: ["lan-scan"],
        product: "C64 Ultimate",
        firmwareVersion: "1.1.0",
        fpgaVersion: "122",
        coreVersion: "1.49",
        hostname: "c64u",
        uniqueId: "5D4E12",
        requiresPassword: false,
        alreadySavedDeviceId: null,
        confidence: "verified",
        lastSeenAt: "2026-06-21T00:00:00.000Z",
      },
      { select: true },
    );

    const snapshot = getSavedDevicesSnapshot();
    const saved = snapshot.devices.find((device) => device.id === persisted.deviceId);

    expect(saved).toMatchObject({
      host: "192.168.1.167",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "c64u",
      lastKnownUniqueId: "5D4E12",
      hasPassword: false,
    });
    expect(snapshot.selectedDeviceId).toBe(persisted.deviceId);
    expect(snapshot.verifiedByDeviceId[persisted.deviceId]).toEqual({
      product: "C64U",
      hostname: "c64u",
      uniqueId: "5D4E12",
    });
  });

  it("updates a known device's host by unique id instead of creating a duplicate when its IP changes", async () => {
    const { addSavedDevice, getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");

    // A previously-saved device last seen at an old IP, with its unique id recorded.
    addSavedDevice({
      id: "known-1",
      name: "My C64U",
      host: "192.168.1.50",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "c64u",
      lastKnownUniqueId: "5D4E12",
      hasPassword: false,
    });
    const countBefore = getSavedDevicesSnapshot().devices.length;

    // The SAME physical device (same unique id) reappears at a NEW address.
    const persisted = persistDiscoveredDevice(
      {
        id: "id:5d4e12",
        address: "192.168.1.167",
        host: null,
        httpPort: 80,
        source: ["lan-scan"],
        product: "C64 Ultimate",
        firmwareVersion: "1.1.0",
        fpgaVersion: "122",
        coreVersion: "1.49",
        hostname: "c64u-new",
        uniqueId: "5D4E12",
        requiresPassword: false,
        alreadySavedDeviceId: null,
        confidence: "verified",
        lastSeenAt: "2026-06-22T00:00:00.000Z",
      },
      { select: false },
    );

    const snapshot = getSavedDevicesSnapshot();
    // The existing entry is reused (matched by unique id) and its host updated — no duplicate.
    expect(persisted.deviceId).toBe("known-1");
    expect(snapshot.devices).toHaveLength(countBefore);
    expect(snapshot.devices.find((device) => device.id === "known-1")?.host).toBe("192.168.1.167");
    expect(snapshot.devices.find((device) => device.id === "known-1")?.lastKnownUniqueId).toBe("5D4E12");
  });

  it("classifies and persists a discovered Ultimate II (U2) device as a first-class family", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        {
          address: "192.168.1.42",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "Ultimate II+",
          firmwareVersion: "3.11",
          fpgaVersion: "45",
          hostname: "ultimate-ii",
          uniqueId: "A1B2C3",
        },
      ],
      scannedHosts: 254,
      elapsedMs: 90,
      unsupported: false,
    });

    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true, timeoutMs: 9_000 });

    // Survives discovery with its raw product string preserved for display.
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      address: "192.168.1.42",
      product: "Ultimate II+",
      hostname: "ultimate-ii",
      uniqueId: "A1B2C3",
      confidence: "verified",
    });

    // Persists with the U2 family (root-cause fix: previously normalized to null).
    const persisted = persistDiscoveredDevice(result.candidates[0], { select: true });
    const saved = getSavedDevicesSnapshot().devices.find((device) => device.id === persisted.deviceId);
    expect(saved).toMatchObject({
      host: "192.168.1.42",
      lastKnownProduct: "U2",
      lastKnownHostname: "ultimate-ii",
      lastKnownUniqueId: "A1B2C3",
    });
    expect(getSavedDevicesSnapshot().verifiedByDeviceId[persisted.deviceId]).toMatchObject({ product: "U2" });
  });

  it("keeps password-required candidates and marks saved devices only when a password is present", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        {
          address: "192.168.1.14",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "C64 Ultimate",
          requiresPassword: true,
        },
      ],
      scannedHosts: 254,
      elapsedMs: 120,
      unsupported: false,
    });

    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "startup", includeLanScan: true, timeoutMs: 8_000 });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      address: "192.168.1.14",
      product: "C64 Ultimate",
      requiresPassword: true,
    });

    const persisted = persistDiscoveredDevice(result.candidates[0], { select: false, passwordPresent: true });
    const saved = getSavedDevicesSnapshot().devices.find((device) => device.id === persisted.deviceId);

    expect(saved).toMatchObject({
      host: "192.168.1.14",
      hasPassword: true,
      lastKnownProduct: "C64U",
    });
  });

  it("notifies subscribers on state changes and stops after unsubscribe", async () => {
    const { subscribeDeviceDiscovery, resetDeviceDiscoveryStateForTests } =
      await import("@/lib/deviceDiscovery/discoveryManager");
    const listener = vi.fn();
    const unsubscribe = subscribeDeviceDiscovery(listener);
    resetDeviceDiscoveryStateForTests();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    resetDeviceDiscoveryStateForTests();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resets discovery state back to idle", async () => {
    discover.mockResolvedValueOnce({ candidates: [], scannedHosts: 5, elapsedMs: 10, unsupported: false });
    const { getDeviceDiscoveryState, resetDeviceDiscoveryStateForTests, startDeviceDiscovery } =
      await import("@/lib/deviceDiscovery/discoveryManager");
    await startDeviceDiscovery({ trigger: "settings" });
    expect(getDeviceDiscoveryState().phase).toBe("complete");
    resetDeviceDiscoveryStateForTests();
    expect(getDeviceDiscoveryState()).toMatchObject({ phase: "idle", scannedHosts: 0, candidates: [], error: null });
  });

  it("records an error state and returns an empty result when the native scan rejects", async () => {
    discover.mockRejectedValueOnce(new Error("native bridge exploded"));
    const { getDeviceDiscoveryState, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");
    const result = await startDeviceDiscovery({ trigger: "startup" });
    expect(result).toEqual({ candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: false });
    expect(getDeviceDiscoveryState()).toMatchObject({ phase: "error", error: "native bridge exploded" });
  });

  it("returns the in-flight promise for a concurrent second discovery call without re-scanning", async () => {
    let resolveDiscover: ((value: unknown) => void) | null = null;
    discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDiscover = resolve;
        }),
    );
    const { startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const first = startDeviceDiscovery({ trigger: "settings" });
    // While the first scan is still pending, a second call must reuse the in-flight discovery
    // (line 190) and short-circuit instead of triggering a second native discover.
    const second = startDeviceDiscovery({ trigger: "startup" });
    expect(discover).toHaveBeenCalledTimes(1);

    resolveDiscover?.({ candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: false });
    const expected = { candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: false };
    await expect(first).resolves.toEqual(expected);
    await expect(second).resolves.toEqual(expected);
    // Still only one native scan despite two callers.
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic failure message when the native scan rejects without a message", async () => {
    discover.mockRejectedValueOnce(new Error(""));
    const { getDeviceDiscoveryState, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");
    const result = await startDeviceDiscovery({ trigger: "startup" });
    expect(result).toEqual({ candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: false });
    // The empty Error.message exercises the `|| "Device discovery failed"` fallback (line 258).
    expect(getDeviceDiscoveryState()).toMatchObject({ phase: "error", error: "Device discovery failed" });
  });

  it("still clears the in-flight discovery when the error-path state notification throws", async () => {
    discover.mockRejectedValueOnce(new Error("scan boom"));
    const { startDeviceDiscovery, subscribeDeviceDiscovery, getDeviceDiscoveryState } =
      await import("@/lib/deviceDiscovery/discoveryManager");

    // A subscriber that throws on the error-path setState makes the catch block itself throw,
    // forcing the `finally { activeDiscovery = null }` to run via abrupt completion (line 271).
    let armed = false;
    const unsubscribe = subscribeDeviceDiscovery(() => {
      if (armed && getDeviceDiscoveryState().phase === "error") {
        throw new Error("listener boom");
      }
    });
    armed = true;

    await expect(startDeviceDiscovery({ trigger: "startup" })).rejects.toThrow("listener boom");
    unsubscribe();

    // activeDiscovery was reset by the finally, so a subsequent scan runs again rather than
    // returning a stale rejected promise.
    discover.mockResolvedValueOnce({ candidates: [], scannedHosts: 1, elapsedMs: 1, unsupported: false });
    const result = await startDeviceDiscovery({ trigger: "settings" });
    expect(result).toEqual({ candidates: [], scannedHosts: 1, elapsedMs: 1, unsupported: false });
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("matches a discovered candidate to an existing saved device by unique id, hostname, then address", async () => {
    const { addSavedDevice } = await import("@/lib/savedDevices/store");
    const { startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    // Three saved devices, each matchable by a different signal.
    addSavedDevice({
      id: "by-unique-id",
      name: "By Unique Id",
      host: "10.0.0.1",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownUniqueId: "AABBCC",
      hasPassword: false,
    });
    addSavedDevice({
      id: "by-hostname",
      name: "By Hostname",
      host: "10.0.0.2",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownHostname: "ultimate-host",
      hasPassword: false,
    });
    addSavedDevice({
      id: "by-address",
      name: "By Address",
      host: "192.168.5.55",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });

    discover.mockResolvedValueOnce({
      candidates: [
        // Matched by lastKnownUniqueId (line 106).
        {
          address: "192.168.1.91",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "C64 Ultimate",
          uniqueId: "AABBCC",
        },
        // No uniqueId; matched by lastKnownHostname (line 113).
        {
          address: "192.168.1.92",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "C64 Ultimate",
          hostname: "ultimate-host",
        },
        // No uniqueId and no hostname match; matched by address against device.host (line 120).
        {
          address: "192.168.5.55",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "C64 Ultimate",
        },
      ],
      scannedHosts: 254,
      elapsedMs: 100,
      unsupported: false,
    });

    const result = await startDeviceDiscovery({ trigger: "settings" });

    const byUnique = result.candidates.find((candidate) => candidate.address === "192.168.1.91");
    const byHostname = result.candidates.find((candidate) => candidate.address === "192.168.1.92");
    const byAddress = result.candidates.find((candidate) => candidate.address === "192.168.5.55");
    expect(byUnique?.alreadySavedDeviceId).toBe("by-unique-id");
    expect(byHostname?.alreadySavedDeviceId).toBe("by-hostname");
    expect(byAddress?.alreadySavedDeviceId).toBe("by-address");
  });

  it("infers a C64 Ultimate product and default http port for password-gated candidates lacking those fields", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        // No product and httpPort 0: product falls back to "C64 Ultimate" (line 133) and
        // httpPort falls back to DEFAULT_HTTP_PORT (line 142).
        {
          address: "192.168.1.77",
          host: null,
          httpPort: 0,
          source: ["lan-scan"],
          requiresPassword: true,
        },
        // No product and not password-gated: product resolves to `undefined` (line 133 else arm),
        // so the candidate is dropped entirely.
        {
          address: "192.168.1.78",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          requiresPassword: false,
        },
      ],
      scannedHosts: 254,
      elapsedMs: 70,
      unsupported: false,
    });

    const { startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");
    const result = await startDeviceDiscovery({ trigger: "startup" });

    expect(result.candidates.map((candidate) => candidate.address)).not.toContain("192.168.1.78");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      address: "192.168.1.77",
      product: "C64 Ultimate",
      httpPort: 80,
      requiresPassword: true,
    });
  });

  it("updates an existing saved device's password flag and reuses it when re-discovered with a password", async () => {
    const { addSavedDevice, getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");

    addSavedDevice({
      id: "known-pw",
      name: "Known",
      host: "192.168.1.50",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownUniqueId: "DEADBE",
      hasPassword: false,
    });

    // Existing device re-discovered with passwordPresent → update path sets hasPassword (line 315).
    const persisted = persistDiscoveredDevice(
      {
        id: "id:deadbe",
        address: "192.168.1.167",
        host: null,
        httpPort: 80,
        source: ["lan-scan"],
        product: "C64 Ultimate",
        firmwareVersion: null,
        fpgaVersion: null,
        coreVersion: null,
        hostname: "c64u",
        uniqueId: "DEADBE",
        requiresPassword: true,
        alreadySavedDeviceId: null,
        confidence: "verified",
        lastSeenAt: "2026-06-22T00:00:00.000Z",
      },
      { passwordPresent: true },
    );

    expect(persisted.deviceId).toBe("known-pw");
    const saved = getSavedDevicesSnapshot().devices.find((device) => device.id === "known-pw");
    expect(saved).toMatchObject({ host: "192.168.1.167", hasPassword: true });
  });

  it("persists a brand-new device with a default http port and empty type when the product is unrecognized", async () => {
    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");

    // New device, httpPort 0 → DEFAULT_HTTP_PORT (line 306); unrecognized product → "" type (line 322).
    const persisted = persistDiscoveredDevice({
      id: "id:unknown",
      address: "192.168.1.200",
      host: null,
      httpPort: 0,
      source: ["lan-scan"],
      product: null,
      firmwareVersion: null,
      fpgaVersion: null,
      coreVersion: null,
      hostname: null,
      uniqueId: null,
      requiresPassword: false,
      alreadySavedDeviceId: null,
      confidence: "verified",
      lastSeenAt: "2026-06-22T00:00:00.000Z",
    });

    expect(persisted.httpPort).toBe(80);
    const saved = getSavedDevicesSnapshot().devices.find((device) => device.id === persisted.deviceId);
    expect(saved).toMatchObject({ host: "192.168.1.200", httpPort: 80, type: "" });
  });

  it("uses a timestamp-derived device id when crypto.randomUUID is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    // Force the fallback id branch (line 303): no usable crypto.randomUUID.
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
      const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");

      const persisted = persistDiscoveredDevice({
        id: "id:nocrypto",
        address: "192.168.1.210",
        host: null,
        httpPort: 80,
        source: ["lan-scan"],
        product: "C64 Ultimate",
        firmwareVersion: null,
        fpgaVersion: null,
        coreVersion: null,
        hostname: null,
        uniqueId: null,
        requiresPassword: false,
        alreadySavedDeviceId: null,
        confidence: "verified",
        lastSeenAt: "2026-06-22T00:00:00.000Z",
      });

      expect(persisted.deviceId).toMatch(/^discovered-/);
      const saved = getSavedDevicesSnapshot().devices.find((device) => device.id === persisted.deviceId);
      expect(saved).toMatchObject({ host: "192.168.1.210" });
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
    }
  });

  it("ranks candidates by selected/saved affinity then identity signals then address", async () => {
    const { addSavedDevice, selectSavedDevice } = await import("@/lib/savedDevices/store");
    const { rankDiscoveredCandidates } = await import("@/lib/deviceDiscovery/discoveryManager");
    addSavedDevice({
      id: "sel",
      name: "Selected",
      host: "192.168.1.50",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      hasPassword: false,
    });
    selectSavedDevice("sel");

    const make = (over: Partial<DeviceDiscoveryCandidate>): DeviceDiscoveryCandidate => ({
      id: over.address ?? "x",
      address: "0.0.0.0",
      host: null,
      httpPort: 80,
      source: ["lan-scan"],
      product: "C64 Ultimate",
      firmwareVersion: null,
      fpgaVersion: null,
      coreVersion: null,
      hostname: null,
      uniqueId: null,
      requiresPassword: false,
      alreadySavedDeviceId: null,
      confidence: "verified",
      lastSeenAt: "2026-06-22T00:00:00.000Z",
      ...over,
    });

    const ranked = rankDiscoveredCandidates([
      make({ address: "192.168.1.9" }),
      make({ address: "192.168.1.2", uniqueId: "ZZ", hostname: "h", source: ["hostname"] }),
      make({ address: "192.168.1.3", alreadySavedDeviceId: "other" }),
      make({ address: "192.168.1.4", alreadySavedDeviceId: "sel" }),
      make({ address: "192.168.1.1" }),
    ]);

    expect(ranked.map((candidate) => candidate.address)).toEqual([
      "192.168.1.4", // selected saved device (+1000 +500)
      "192.168.1.3", // saved but not selected (+500)
      "192.168.1.2", // unique id + hostname + hostname source
      "192.168.1.1", // address tiebreak before .9
      "192.168.1.9",
    ]);
  });
});

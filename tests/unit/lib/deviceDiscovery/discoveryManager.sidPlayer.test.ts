/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const discover = vi.fn();

vi.mock("@/lib/native/deviceDiscovery", () => ({ DeviceDiscovery: { discover } }));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details: Record<string, unknown> = {}) => ({ ...details })),
}));

const found = {
  candidates: [
    {
      address: "192.0.2.13",
      httpPort: 80,
      source: ["lan-scan"],
      product: "Ultimate 64 Elite",
      firmwareVersion: "3.14e",
      hostname: "u64",
      uniqueId: "38C1BA",
    },
  ],
  scannedHosts: 254,
  elapsedMs: 5000,
  unsupported: false,
};

describe("device discovery after SID Player was chosen", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    discover.mockReset();
  });

  it("SPM-FRST-01 a native scan that finishes after the switch leaves no result behind", async () => {
    let finishScan: (value: typeof found) => void = () => undefined;
    discover.mockImplementationOnce(() => new Promise((resolve) => (finishScan = resolve)));
    const manager = await import("@/lib/deviceDiscovery/discoveryManager");

    const scanning = manager.startDeviceDiscovery({ trigger: "startup", includeLanScan: true });
    expect(manager.getDeviceDiscoveryState().phase).toBe("scanning");

    manager.discardDeviceDiscovery();
    finishScan(found);
    await scanning;

    expect(manager.getDeviceDiscoveryState().phase).toBe("idle");
    expect(manager.getDeviceDiscoveryState().candidates).toEqual([]);
  });

  it("SPM-FRST-01 a scan started after the switch is a new scan, not the abandoned one", async () => {
    let finishFirst: (value: typeof found) => void = () => undefined;
    discover.mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)));
    discover.mockResolvedValueOnce(found);
    const manager = await import("@/lib/deviceDiscovery/discoveryManager");

    const first = manager.startDeviceDiscovery({ trigger: "startup", includeLanScan: true });
    manager.discardDeviceDiscovery();
    const second = await manager.startDeviceDiscovery({ trigger: "manual", includeLanScan: true });
    finishFirst(found);
    await first;

    expect(second.candidates).toHaveLength(1);
    expect(manager.getDeviceDiscoveryState().phase).toBe("complete");
    expect(manager.getDeviceDiscoveryState().trigger).toBe("manual");
  });
});

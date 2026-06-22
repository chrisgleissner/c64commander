/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { DeviceDiscoveryWeb } from "@/lib/native/deviceDiscovery.web";
import type { NativeDeviceDiscoveryResult } from "@/lib/native/deviceDiscovery";

type MockGlobal = typeof globalThis & {
  __c64uMockDeviceDiscovery?: Partial<NativeDeviceDiscoveryResult>;
};

const setMock = (value: Partial<NativeDeviceDiscoveryResult> | undefined) => {
  if (value === undefined) {
    delete (globalThis as MockGlobal).__c64uMockDeviceDiscovery;
  } else {
    (globalThis as MockGlobal).__c64uMockDeviceDiscovery = value;
  }
};

describe("DeviceDiscoveryWeb", () => {
  afterEach(() => setMock(undefined));

  it("reports unsupported on a real web build (no injected test seam)", async () => {
    const result = await new DeviceDiscoveryWeb().discover({});
    expect(result).toEqual({ candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: true });
  });

  it("returns the injected candidates and defaults scannedHosts/elapsedMs from them", async () => {
    setMock({ candidates: [{ address: "192.168.1.5", hostname: "c64u" }] });

    const result = await new DeviceDiscoveryWeb().discover({});

    expect(result.unsupported).toBe(false);
    expect(result.candidates).toEqual([{ address: "192.168.1.5", hostname: "c64u" }]);
    // scannedHosts defaults to the candidate count, elapsedMs to 0.
    expect(result.scannedHosts).toBe(1);
    expect(result.elapsedMs).toBe(0);
  });

  it("honours explicit scannedHosts and elapsedMs in the injected seam", async () => {
    setMock({ candidates: [{ address: "10.0.0.9" }], scannedHosts: 42, elapsedMs: 7 });

    const result = await new DeviceDiscoveryWeb().discover({});

    expect(result.scannedHosts).toBe(42);
    expect(result.elapsedMs).toBe(7);
    expect(result.unsupported).toBe(false);
  });

  it("ignores an injected seam that carries no candidates", async () => {
    setMock({ scannedHosts: 99 });

    const result = await new DeviceDiscoveryWeb().discover({});

    expect(result).toEqual({ candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: true });
  });
});

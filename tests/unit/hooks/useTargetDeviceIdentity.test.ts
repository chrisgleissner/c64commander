/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connection: "REAL_CONNECTED" }));

vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: state.connection }) }));
vi.mock("@/hooks/useSavedDevices", () => ({
  useSavedDevices: () => ({
    selectedDeviceId: "u2",
    hasEverHadMultipleDevices: true,
    verifiedByDeviceId: { u2: { product: "U2" } },
    devices: [
      { id: "c64u", name: "", host: "c64u" },
      { id: "u2", name: "", host: "192.168.1.74" },
    ],
  }),
}));
vi.mock("@/lib/savedDevices/store", () => ({
  buildSavedDevicePrimaryLabel: (device: { name: string; host: string }) => device.name || device.host,
}));

import { useTargetDeviceIdentity } from "@/hooks/useTargetDeviceIdentity";

describe("useTargetDeviceIdentity", () => {
  beforeEach(() => {
    state.connection = "REAL_CONNECTED";
  });

  it("names the selected saved device while the app drives a real one", () => {
    const { result } = renderHook(() => useTargetDeviceIdentity());

    expect(result.current).toEqual({ deviceId: "u2", multiDevice: true, fullLabel: "192.168.1.74", shortLabel: "U2" });
  });

  it("names no saved device in Demo Mode, where commands go to the simulated device", () => {
    state.connection = "DEMO_ACTIVE";
    const { result } = renderHook(() => useTargetDeviceIdentity());

    expect(result.current).toEqual({ deviceId: null, multiDevice: false, fullLabel: null, shortLabel: null });
  });
});

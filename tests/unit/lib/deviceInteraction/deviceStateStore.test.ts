/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracing/traceContext", () => ({
  setTraceDeviceContext: vi.fn(),
}));

import {
  getDeviceStateSnapshot,
  markDeviceRequestEnd,
  markDeviceRequestStart,
  setCircuitOpenUntil,
  updateDeviceConnectionState,
} from "@/lib/deviceInteraction/deviceStateStore";

describe("deviceStateStore branch coverage", () => {
  beforeEach(() => {
    // Reset module state by driving to UNKNOWN and clearing circuit/busy
    updateDeviceConnectionState("UNKNOWN");
    setCircuitOpenUntil(null);
    // Drain busy count if any
    const snap = getDeviceStateSnapshot();
    for (let i = 0; i < snap.busyCount; i++) {
      markDeviceRequestEnd({ success: false });
    }
  });

  it("resolveBaseState returns CONNECTING when REAL_CONNECTED but no successful request yet (line 53 false)", () => {
    updateDeviceConnectionState("REAL_CONNECTED");
    // hasSuccessfulRequest is false after transition → CONNECTING
    expect(getDeviceStateSnapshot().state).toBe("CONNECTING");
  });

  it("resolveBaseState returns READY via DEMO_ACTIVE (line 52 right-side of ||)", () => {
    updateDeviceConnectionState("DEMO_ACTIVE");
    markDeviceRequestEnd({ success: true });
    expect(getDeviceStateSnapshot().state).toBe("READY");
  });

  it("computeState returns BUSY when READY and request in flight (line 61)", () => {
    updateDeviceConnectionState("REAL_CONNECTED");
    markDeviceRequestEnd({ success: true });
    expect(getDeviceStateSnapshot().state).toBe("READY");
    markDeviceRequestStart();
    expect(getDeviceStateSnapshot().state).toBe("BUSY");
    markDeviceRequestEnd({ success: true });
  });

  it("computeState returns ERROR when circuit is open (line 59)", () => {
    updateDeviceConnectionState("REAL_CONNECTED");
    markDeviceRequestEnd({ success: true });
    setCircuitOpenUntil(Date.now() + 60_000, "test circuit");
    expect(getDeviceStateSnapshot().state).toBe("ERROR");
    setCircuitOpenUntil(null);
  });

  it("setCircuitOpenUntil falls back to existing lastErrorMessage when reason is undefined (line 122 ?? fallback)", () => {
    markDeviceRequestEnd({ success: false, errorMessage: "prev error" });
    // Call setCircuitOpenUntil without reason — should keep prev error
    setCircuitOpenUntil(Date.now() + 60_000);
    expect(getDeviceStateSnapshot().lastErrorMessage).toBe("prev error");
    setCircuitOpenUntil(null);
  });

  it("resolveBaseState falls through to final UNKNOWN for unrecognised connectionState (line 53)", () => {
    // Cast to bypass type check — exercises the unreachable last return "UNKNOWN"
    updateDeviceConnectionState("PENDING_FIRMWARE_UPDATE" as Parameters<typeof updateDeviceConnectionState>[0]);
    expect(getDeviceStateSnapshot().state).toBe("UNKNOWN");
  });
});

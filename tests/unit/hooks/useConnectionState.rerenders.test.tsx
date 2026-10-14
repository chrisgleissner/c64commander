/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Snapshot = Record<string, unknown>;

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: { snapshot: Snapshot } = { snapshot: {} };
  return {
    listeners,
    state,
    set(next: Snapshot) {
      state.snapshot = Object.freeze(next);
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => store.state.snapshot,
  subscribeConnection: (listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
}));

import { useConnectionProbeState, useConnectionState } from "@/hooks/useConnectionState";

const baseSnapshot = (): Snapshot => ({
  state: "REAL_CONNECTED",
  lastDiscoveryTrigger: "startup",
  lastTransitionAtMs: 1000,
  lastProbeAtMs: 1,
  lastProbeSucceededAtMs: 1,
  lastProbeFailedAtMs: null,
  lastProbeError: null,
  deviceInfo: { product: "C64 Ultimate", hostname: "c64u", unique_id: "A1" },
  demoInterstitialVisible: false,
  demoInterstitialReason: null,
});

describe("useConnectionState", () => {
  beforeEach(() => {
    store.listeners.clear();
    store.state.snapshot = Object.freeze(baseSnapshot());
  });

  it("keeps its identity when only the probe timestamps and an equal device info arrive", () => {
    const { result } = renderHook(() => useConnectionState());
    const first = result.current;

    act(() => {
      store.set({
        ...baseSnapshot(),
        lastProbeAtMs: 2,
        lastProbeSucceededAtMs: 2,
        deviceInfo: { product: "C64 Ultimate", hostname: "c64u", unique_id: "A1" },
      });
    });

    expect(result.current).toBe(first);
  });

  it("does not render the component again for a probe-timestamp-only change", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useConnectionState();
    });
    const rendersBefore = renders;

    act(() => store.set({ ...baseSnapshot(), lastProbeSucceededAtMs: 5 }));
    act(() => store.set({ ...baseSnapshot(), lastProbeSucceededAtMs: 6 }));

    expect(renders).toBe(rendersBefore);
  });

  it.each([
    ["the state", { state: "OFFLINE_NO_DEMO" }],
    ["the probe error", { lastProbeError: "Password required" }],
    ["the device identity", { deviceInfo: { product: "C64 Ultimate", hostname: "c64u", unique_id: "B2" } }],
    ["the demo interstitial", { demoInterstitialVisible: true }],
  ])("returns a new snapshot when %s changes", (_label, patch) => {
    const { result } = renderHook(() => useConnectionState());
    const first = result.current;

    act(() => store.set({ ...baseSnapshot(), ...patch }));

    expect(result.current).not.toBe(first);
    expect(result.current).toMatchObject(patch);
  });

  it("leaves the probe timestamps out of the snapshot", () => {
    const { result } = renderHook(() => useConnectionState());

    expect(result.current).not.toHaveProperty("lastProbeSucceededAtMs");
    expect(result.current).not.toHaveProperty("lastProbeFailedAtMs");
    expect(result.current).not.toHaveProperty("lastProbeAtMs");
  });
});

describe("useConnectionProbeState", () => {
  it("follows every probe timestamp change", () => {
    store.listeners.clear();
    store.state.snapshot = Object.freeze(baseSnapshot());
    const { result } = renderHook(() => useConnectionProbeState());

    act(() => store.set({ ...baseSnapshot(), lastProbeSucceededAtMs: 9 }));

    expect(result.current.lastProbeSucceededAtMs).toBe(9);
  });
});

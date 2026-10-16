/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const snapshot = {
  state: "REAL_CONNECTED",
  lastDiscoveryTrigger: null,
  lastTransitionAtMs: 0,
  lastProbeAtMs: null,
  lastProbeSucceededAtMs: null,
  lastProbeFailedAtMs: null,
  lastProbeError: null,
  demoInterstitialVisible: false,
};

const connectionMocks = vi.hoisted(() => ({
  subscribeConnection: vi.fn(),
  getConnectionSnapshot: vi.fn(),
}));

const reactMocks = vi.hoisted(() => ({
  useSyncExternalStore: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useSyncExternalStore: (...args: unknown[]) => reactMocks.useSyncExternalStore(...args),
  };
});

vi.mock("@/lib/connection/connectionManager", () => ({
  subscribeConnection: connectionMocks.subscribeConnection,
  getConnectionSnapshot: connectionMocks.getConnectionSnapshot,
}));

import { useConnectionProbeState, useConnectionState } from "@/hooks/useConnectionState";

describe("useConnectionState", () => {
  it("subscribes to the connection manager and reads the snapshot without probe timestamps", () => {
    connectionMocks.getConnectionSnapshot.mockReturnValue(snapshot);
    reactMocks.useSyncExternalStore.mockReturnValue(snapshot);
    const { result } = renderHook(() => useConnectionState());

    expect(result.current).toEqual(snapshot);
    const [subscribe, getSnapshot] = reactMocks.useSyncExternalStore.mock.calls.at(-1)!;
    expect(subscribe).toBe(connectionMocks.subscribeConnection);
    expect(getSnapshot()).not.toHaveProperty("lastProbeSucceededAtMs");
  });

  it("hands the whole snapshot to a reader of the probe state", () => {
    connectionMocks.getConnectionSnapshot.mockReturnValue(snapshot);
    reactMocks.useSyncExternalStore.mockReturnValue(snapshot);
    renderHook(() => useConnectionProbeState());

    expect(reactMocks.useSyncExternalStore).toHaveBeenLastCalledWith(
      connectionMocks.subscribeConnection,
      connectionMocks.getConnectionSnapshot,
      connectionMocks.getConnectionSnapshot,
    );
  });
});

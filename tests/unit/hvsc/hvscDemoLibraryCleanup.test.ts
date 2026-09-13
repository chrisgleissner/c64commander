/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "@/lib/connection/connectionManager";
import {
  createHvscDemoLibraryCleanup,
  subscribeHvscDemoLibraryRemoved,
  type HvscDemoLibraryCleanupDeps,
} from "@/lib/hvsc/hvscDemoLibraryCleanup";
import type { HvscState } from "@/lib/hvsc/hvscStateStore";
import { addErrorLog, addLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

// Lets the evaluation a trigger started run to completion; every fake here resolves immediately.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const demoState = (): HvscState => ({
  installedBaselineVersion: 84,
  installedVersion: 84,
  ingestionState: "ready",
  lastUpdateCheckUtcMs: null,
  ingestionError: null,
  ingestionSummary: null,
  updates: {},
  librarySource: "demo",
});

/** A connection, a Demo Mode release and an ingestion runtime the test moves by hand. */
const createRig = (initial: { connectionState: ConnectionState; simulatedReleaseActive?: boolean }) => {
  const listeners = new Set<() => void>();
  const rig = {
    connectionState: initial.connectionState,
    simulatedReleaseActive: initial.simulatedReleaseActive ?? false,
    ingestionActive: false,
    state: demoState(),
    removeLibrary: vi.fn(async () => {
      rig.state = { ...rig.state, installedVersion: 0, installedBaselineVersion: null, librarySource: "real" };
    }),
    /** Change something, then fire the triggers the way the real subscriptions would. */
    change: async (
      patch: Partial<Pick<typeof rig, "connectionState" | "simulatedReleaseActive" | "ingestionActive">>,
    ) => {
      Object.assign(rig, patch);
      listeners.forEach((listener) => listener());
      await settle();
    },
  };
  const deps: HvscDemoLibraryCleanupDeps = {
    getConnectionState: () => rig.connectionState,
    isSimulatedReleaseActive: () => rig.simulatedReleaseActive,
    isIngestionActive: () => rig.ingestionActive,
    loadState: () => rig.state,
    removeLibrary: rig.removeLibrary,
    triggers: [
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    ],
  };
  const cleanup = createHvscDemoLibraryCleanup(deps);
  return { rig, cleanup, listeners };
};

describe("hvscDemoLibraryCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each<ConnectionState>(["OFFLINE_NO_DEMO", "REAL_CONNECTED"])(
    "removes Demo Mode's library on the first evaluation after a restart that settled on %s",
    async (connectionState) => {
      const { rig, cleanup } = createRig({ connectionState });
      const removed = vi.fn();
      const unsubscribe = subscribeHvscDemoLibraryRemoved(removed);

      const stop = cleanup.start();
      await settle();

      expect(rig.removeLibrary).toHaveBeenCalledTimes(1);
      expect(rig.state.installedVersion).toBe(0);
      expect(removed).toHaveBeenCalledTimes(1);
      expect(addLog).toHaveBeenCalledWith(
        "info",
        "Removing the HVSC library installed from Demo Mode",
        expect.objectContaining({ connectionState, installedVersion: 84, reason: expect.any(String) }),
      );
      stop();
      unsubscribe();
    },
  );

  it.each<ConnectionState>(["UNKNOWN", "DISCOVERING", "DEMO_ACTIVE"])(
    "keeps Demo Mode's library while the connection is %s",
    async (connectionState) => {
      const { rig, cleanup } = createRig({ connectionState });

      cleanup.start();
      await settle();

      expect(rig.removeLibrary).not.toHaveBeenCalled();
      expect(rig.state.librarySource).toBe("demo");
    },
  );

  it("removes it once an offline launch leaves Demo Mode and the simulated release stops being served", async () => {
    const { rig, cleanup } = createRig({ connectionState: "UNKNOWN" });
    cleanup.start();

    await rig.change({ connectionState: "DISCOVERING" });
    await rig.change({ connectionState: "DEMO_ACTIVE", simulatedReleaseActive: true });
    // The user declines: OFFLINE_NO_DEMO is announced before the demo server stops serving HVSC.
    await rig.change({ connectionState: "OFFLINE_NO_DEMO" });
    expect(rig.removeLibrary).not.toHaveBeenCalled();

    await rig.change({ simulatedReleaseActive: false });
    expect(rig.removeLibrary).toHaveBeenCalledTimes(1);
  });

  it("waits for a running install to finish before removing the library", async () => {
    const { rig, cleanup } = createRig({ connectionState: "REAL_CONNECTED" });
    rig.ingestionActive = true;
    cleanup.start();
    await settle();
    expect(rig.removeLibrary).not.toHaveBeenCalled();

    await rig.change({ ingestionActive: false });
    expect(rig.removeLibrary).toHaveBeenCalledTimes(1);
  });

  it("never removes a real library", async () => {
    const { rig, cleanup } = createRig({ connectionState: "REAL_CONNECTED" });
    rig.state = { ...rig.state, librarySource: "real" };

    cleanup.start();
    await rig.change({ connectionState: "OFFLINE_NO_DEMO" });

    expect(rig.removeLibrary).not.toHaveBeenCalled();
  });

  it("removes the library once when several triggers arrive during the removal", async () => {
    const { rig, cleanup, listeners } = createRig({ connectionState: "REAL_CONNECTED" });
    cleanup.start();
    listeners.forEach((listener) => listener());
    listeners.forEach((listener) => listener());
    await settle();

    expect(rig.removeLibrary).toHaveBeenCalledTimes(1);
  });

  it("logs a failed removal at error level and does not report the library as removed", async () => {
    const { rig, cleanup } = createRig({ connectionState: "OFFLINE_NO_DEMO" });
    rig.removeLibrary.mockRejectedValueOnce(new Error("rmdir failed"));
    const removed = vi.fn();
    const unsubscribe = subscribeHvscDemoLibraryRemoved(removed);

    await cleanup.evaluate();

    expect(addErrorLog).toHaveBeenCalledWith(
      "Failed to remove the HVSC library installed from Demo Mode",
      expect.objectContaining({
        connectionState: "OFFLINE_NO_DEMO",
        error: expect.objectContaining({ message: "rmdir failed" }),
      }),
    );
    expect(removed).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops listening when stopped", async () => {
    const { rig, cleanup, listeners } = createRig({ connectionState: "DEMO_ACTIVE" });
    const stop = cleanup.start();
    await settle();
    stop();

    expect(listeners.size).toBe(0);
    expect(rig.removeLibrary).not.toHaveBeenCalled();
  });
});

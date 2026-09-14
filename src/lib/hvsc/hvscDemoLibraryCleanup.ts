/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getConnectionSnapshot, subscribeConnection, type ConnectionState } from "@/lib/connection/connectionManager";
import { addErrorLog, addLog } from "@/lib/logging";
import { isIngestionRuntimeActive, subscribeIngestionRuntimeIdle } from "./hvscIngestionRuntimeSupport";
import { shouldRemoveDemoLibrary } from "./hvscLibrarySource";
import { isRuntimeHvscBaseUrlActive, subscribeRuntimeHvscBaseUrl } from "./hvscReleaseService";
import { clearHvscStatusSummary } from "./hvscStatusStore";
import { loadHvscState, type HvscState } from "./hvscStateStore";

type Subscribe = (listener: () => void) => () => void;

export type HvscDemoLibraryCleanupDeps = {
  getConnectionState: () => ConnectionState;
  isSimulatedReleaseActive: () => boolean;
  isIngestionActive: () => boolean;
  loadState: () => HvscState;
  removeLibrary: () => Promise<void>;
  /** Every event after which the decision can have changed. */
  triggers: Subscribe[];
};

const removedListeners = new Set<() => void>();

/** Called after a library installed from Demo Mode has been removed, so an open page can re-read. */
export const subscribeHvscDemoLibraryRemoved: Subscribe = (listener) => {
  removedListeners.add(listener);
  return () => {
    removedListeners.delete(listener);
  };
};

/**
 * Removes the HVSC data Demo Mode installed once the app has settled outside Demo Mode.
 * Evaluated when started as well as on every trigger, so a launch that settles straight into
 * `OFFLINE_NO_DEMO` or `REAL_CONNECTED` removes it without ever observing a transition.
 */
export const createHvscDemoLibraryCleanup = (deps: HvscDemoLibraryCleanupDeps) => {
  let running: Promise<void> | null = null;
  let evaluateAgain = false;

  const removeIfSettled = async () => {
    const connectionState = deps.getConnectionState();
    const state = deps.loadState();
    const remove = shouldRemoveDemoLibrary({
      connectionState,
      simulatedReleaseActive: deps.isSimulatedReleaseActive(),
      librarySource: state.librarySource,
      ingestionActive: deps.isIngestionActive(),
    });
    if (!remove) return;
    addLog("info", "Removing the HVSC library installed from Demo Mode", {
      connectionState,
      installedVersion: state.installedVersion,
      reason: "The app has settled outside Demo Mode, so the simulated device's tunes must not stay installed",
    });
    await deps.removeLibrary();
    removedListeners.forEach((listener) => listener());
  };

  const evaluate = (): Promise<void> => {
    if (running) {
      evaluateAgain = true;
      return running;
    }
    running = (async () => {
      do {
        evaluateAgain = false;
        try {
          await removeIfSettled();
        } catch (error) {
          const err = error as Error;
          addErrorLog("Failed to remove the HVSC library installed from Demo Mode", {
            connectionState: deps.getConnectionState(),
            error: { name: err.name, message: err.message, stack: err.stack },
          });
        }
      } while (evaluateAgain);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  const start = () => {
    const unsubscribes = deps.triggers.map((subscribe) => subscribe(() => void evaluate()));
    void evaluate();
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  };

  return { evaluate, start };
};

// Connection snapshots change on every probe; only a change of state can change the decision.
const subscribeConnectionState: Subscribe = (listener) => {
  let last = getConnectionSnapshot().state;
  return subscribeConnection(() => {
    const next = getConnectionSnapshot().state;
    if (next === last) return;
    last = next;
    listener();
  });
};

/** The removal the Play page's Reset HVSC button performs. The service loads only when it is needed. */
const removeLibraryLikeResetButton = async () => {
  const { resetHvscLibraryData } = await import("./hvscService");
  await resetHvscLibraryData();
  clearHvscStatusSummary();
  const { removeDemoTunesFromPlaylist } = await import("./hvscDemoPlaylistCleanup");
  await removeDemoTunesFromPlaylist();
};

export const installHvscDemoLibraryCleanup = () =>
  createHvscDemoLibraryCleanup({
    getConnectionState: () => getConnectionSnapshot().state,
    isSimulatedReleaseActive: isRuntimeHvscBaseUrlActive,
    isIngestionActive: isIngestionRuntimeActive,
    loadState: loadHvscState,
    removeLibrary: removeLibraryLikeResetButton,
    triggers: [subscribeConnectionState, subscribeRuntimeHvscBaseUrl, subscribeIngestionRuntimeIdle],
  }).start();

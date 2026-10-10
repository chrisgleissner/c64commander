/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

const ScreenActivityContext = createContext(true);
const AppVisibilityContext = createContext(true);

type ActivityState = { active: boolean; appVisible: boolean };

/** The same state as the two contexts, readable through a selector so a reader re-renders only when its answer changes. */
class ActivityStore {
  private readonly listeners = new Set<() => void>();

  constructor(private state: ActivityState) {}

  readonly read = () => this.state;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(next: ActivityState) {
    if (next.active === this.state.active && next.appVisible === this.state.appVisible) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

const ActivityStoreContext = createContext(new ActivityStore({ active: true, appVisible: true }));

const isDocumentVisible = () => {
  if (typeof document === "undefined") return true;
  return !document.hidden;
};

export function ScreenActivityProvider({ active, children }: { active: boolean; children: React.ReactNode }) {
  const [appVisible, setAppVisible] = useState(() => isDocumentVisible());

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      setAppVisible(isDocumentVisible());
    };
    const handlePageShow = () => {
      setAppVisible(true);
    };
    const handlePageHide = () => {
      setAppVisible(false);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  const [store] = useState(() => new ActivityStore({ active, appVisible }));
  useLayoutEffect(() => store.set({ active, appVisible }), [store, active, appVisible]);

  return (
    <ActivityStoreContext.Provider value={store}>
      <AppVisibilityContext.Provider value={appVisible}>
        <ScreenActivityContext.Provider value={active && appVisible}>{children}</ScreenActivityContext.Provider>
      </AppVisibilityContext.Provider>
    </ActivityStoreContext.Provider>
  );
}

export const useScreenActivity = () => useContext(ScreenActivityContext);
export const useAppVisibilityState = () => useContext(AppVisibilityContext);

/**
 * `wanted && (screen active || app hidden)`, the condition a device query runs under, without re-rendering when a page
 * is shown or hidden while `wanted` is false. A config row whose item is cached never fetches, and Config holds
 * hundreds of them: each re-rendered on every tab switch only to compute `false` again.
 */
export const useScreenQueryGate = (wanted: boolean): boolean => {
  const store = useContext(ActivityStoreContext);
  return useSyncExternalStore(store.subscribe, () => {
    const { active, appVisible } = store.read();
    return wanted && ((active && appVisible) || !appVisible);
  });
};

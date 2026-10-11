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
const PageActivityContext = createContext(true);

type ActivityState = { active: boolean; appVisible: boolean; pageActive: boolean };

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
    const { active, appVisible, pageActive } = this.state;
    if (next.active === active && next.appVisible === appVisible && next.pageActive === pageActive) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

const ActivityStoreContext = createContext(new ActivityStore({ active: true, appVisible: true, pageActive: true }));

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

  // The page's answer from before the app was hidden stands while it is hidden: backgrounding never unmounted a page,
  // and a page kept out of sight must not wake up because the whole app went to the background.
  const [activeWhileVisible, setActiveWhileVisible] = useState(active);
  if (appVisible && activeWhileVisible !== active) setActiveWhileVisible(active);
  const pageActive = appVisible ? active : activeWhileVisible;

  const [store] = useState(() => new ActivityStore({ active, appVisible, pageActive }));
  useLayoutEffect(() => store.set({ active, appVisible, pageActive }), [store, active, appVisible, pageActive]);

  return (
    <ActivityStoreContext.Provider value={store}>
      <AppVisibilityContext.Provider value={appVisible}>
        <PageActivityContext.Provider value={pageActive}>
          <ScreenActivityContext.Provider value={active && appVisible}>{children}</ScreenActivityContext.Provider>
        </PageActivityContext.Provider>
      </AppVisibilityContext.Provider>
    </ActivityStoreContext.Provider>
  );
}

export const useScreenActivity = () => useContext(ScreenActivityContext);
export const useAppVisibilityState = () => useContext(AppVisibilityContext);

/**
 * Whether this page is the tab on screen, whatever the app itself is doing: while the app is in the background a page
 * keeps the answer it had before, as it stayed mounted or unmounted before pages were kept.
 */
export const usePageActivityState = () => useContext(PageActivityContext);

/**
 * `wanted` while this page is the tab on screen, the condition a device query runs under. While the app is in the
 * background the page on screen keeps its queries and a kept page keeps none. Read through a selector, so a reader
 * whose answer does not change is not re-rendered when a page is shown or hidden: a config row whose item is cached
 * never fetches, and Config holds hundreds of them.
 */
export const useScreenQueryGate = (wanted: boolean): boolean => {
  const store = useContext(ActivityStoreContext);
  return useSyncExternalStore(store.subscribe, () => wanted && store.read().pageActive);
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { createContext, useContext, useEffect, useState } from "react";

const ScreenActivityContext = createContext(true);
const AppVisibilityContext = createContext(true);

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

  return (
    <AppVisibilityContext.Provider value={appVisible}>
      <ScreenActivityContext.Provider value={active && appVisible}>{children}</ScreenActivityContext.Provider>
    </AppVisibilityContext.Provider>
  );
}

export const useScreenActivity = () => useContext(ScreenActivityContext);
export const useAppVisibilityState = () => useContext(AppVisibilityContext);

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useAppStyle } from "@/hooks/useAppStyle";
import { useDeviceColorScheme } from "@/hooks/useDeviceColorScheme";
import type { AppStyle, AppStyleMode } from "@/generated/appStyles";

interface AppStyleContextType {
  storedStyleId: string | null;
  setStyleId: (next: string) => void;
  isMatchMyDevice: boolean;
  matchedDeviceStyleId: string | null;
  styleId: string;
  mode: AppStyleMode;
  themeClamped: boolean;
  styles: readonly AppStyle[];
  defaultStyleId: string;
  /** Re-reads the device's Color Scheme now. Settings' "Refresh connection" calls this too. */
  refreshDeviceColorScheme: () => Promise<void>;
}

const AppStyleContext = createContext<AppStyleContextType | undefined>(undefined);

/**
 * Mounted once, alongside ThemeProvider, so a single instance owns the DOM effects
 * (data-app-style, the .dark clamp, the native system bar, the web theme-color meta tag).
 * Must be nested inside ThemeProvider — it reads theme/resolvedTheme from useThemeContext().
 */
export function AppStyleProvider({ children }: { children: ReactNode }) {
  const { colorScheme: deviceColorScheme, refresh: refreshDeviceColorScheme } = useDeviceColorScheme();
  const appStyleValues = useAppStyle(deviceColorScheme);

  return (
    <AppStyleContext.Provider value={{ ...appStyleValues, refreshDeviceColorScheme }}>
      {children}
    </AppStyleContext.Provider>
  );
}

export function useAppStyleContext() {
  const context = useContext(AppStyleContext);
  if (!context) {
    throw new Error("useAppStyleContext must be used within AppStyleProvider");
  }
  return context;
}

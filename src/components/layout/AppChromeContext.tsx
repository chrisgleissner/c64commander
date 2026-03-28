/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type AppChromeMode = "fixed" | "sticky";

const AppChromeModeContext = createContext<AppChromeMode>("fixed");

export function AppChromeModeProvider({ mode, children }: { mode: AppChromeMode; children: ReactNode }) {
  return <AppChromeModeContext.Provider value={mode}>{children}</AppChromeModeContext.Provider>;
}

export const useAppChromeMode = () => useContext(AppChromeModeContext);

export const usePrimaryPageShellClassName = (className?: string) => {
  const appChromeMode = useAppChromeMode();
  return cn(
    "flex min-h-0 flex-col overflow-hidden",
    appChromeMode === "fixed" ? "min-h-screen pt-[var(--app-bar-height)]" : "h-full",
    className,
  );
};

import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

type AppChromeMode = "fixed" | "sticky";

const AppChromeModeContext = createContext<AppChromeMode>("fixed");

export function AppChromeModeProvider({ mode, children }: { mode: AppChromeMode; children: React.ReactNode }) {
  return <AppChromeModeContext.Provider value={mode}>{children}</AppChromeModeContext.Provider>;
}

export const useAppChromeMode = () => useContext(AppChromeModeContext);

export const usePrimaryPageShellClassName = (className?: string) => {
  const appChromeMode = useAppChromeMode();
  return cn("min-h-screen", appChromeMode === "fixed" ? "pt-[var(--app-bar-height)]" : undefined, className);
};

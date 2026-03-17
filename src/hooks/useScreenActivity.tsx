import React, { createContext, useContext } from "react";

const ScreenActivityContext = createContext(true);

export function ScreenActivityProvider({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <ScreenActivityContext.Provider value={active}>{children}</ScreenActivityContext.Provider>;
}

export const useScreenActivity = () => useContext(ScreenActivityContext);

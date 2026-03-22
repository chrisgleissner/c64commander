/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React, { createContext, useContext } from "react";

const ScreenActivityContext = createContext(true);

export function ScreenActivityProvider({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <ScreenActivityContext.Provider value={active}>{children}</ScreenActivityContext.Provider>;
}

export const useScreenActivity = () => useContext(ScreenActivityContext);

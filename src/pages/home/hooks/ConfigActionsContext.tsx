/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useConfigActions } from "./useConfigActions";

type ConfigActionsValue = ReturnType<typeof useConfigActions>;

const ConfigActionsContext = createContext<ConfigActionsValue | null>(null);

export function ConfigActionsProvider({ children }: { children: ReactNode }) {
  const actions = useConfigActions();
  return <ConfigActionsContext.Provider value={actions}>{children}</ConfigActionsContext.Provider>;
}

export function useSharedConfigActions(): ConfigActionsValue {
  const context = useContext(ConfigActionsContext);
  if (!context) {
    throw new Error("useSharedConfigActions must be used within a ConfigActionsProvider");
  }
  return context;
}

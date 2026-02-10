/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type RefreshControlContextValue = {
  configExpandedCount: number;
  setConfigExpanded: (id: string, isOpen: boolean) => void;
};

const RefreshControlContext = createContext<RefreshControlContextValue | undefined>(undefined);

export function RefreshControlProvider({ children }: { children: React.ReactNode }) {
  const [configExpanded, setConfigExpandedState] = useState<Set<string>>(() => new Set());

  const setConfigExpanded = useCallback((id: string, isOpen: boolean) => {
    setConfigExpandedState((prev) => {
      const next = new Set(prev);
      if (isOpen) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      configExpandedCount: configExpanded.size,
      setConfigExpanded,
    }),
    [configExpanded, setConfigExpanded],
  );

  return (
    <RefreshControlContext.Provider value={value}>
      {children}
    </RefreshControlContext.Provider>
  );
}

export function useRefreshControl() {
  const ctx = useContext(RefreshControlContext);
  if (!ctx) {
    throw new Error('useRefreshControl must be used within RefreshControlProvider');
  }
  return ctx;
}

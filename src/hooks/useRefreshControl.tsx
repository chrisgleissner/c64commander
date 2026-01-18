import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type RefreshControlContextValue = {
  quickExpandedCount: number;
  configExpandedCount: number;
  setQuickExpanded: (id: string, isOpen: boolean) => void;
  setConfigExpanded: (id: string, isOpen: boolean) => void;
};

const RefreshControlContext = createContext<RefreshControlContextValue | undefined>(undefined);

export function RefreshControlProvider({ children }: { children: React.ReactNode }) {
  const [quickExpanded, setQuickExpandedState] = useState<Set<string>>(() => new Set());
  const [configExpanded, setConfigExpandedState] = useState<Set<string>>(() => new Set());

  const setQuickExpanded = useCallback((id: string, isOpen: boolean) => {
    setQuickExpandedState((prev) => {
      const next = new Set(prev);
      if (isOpen) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

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
      quickExpandedCount: quickExpanded.size,
      configExpandedCount: configExpanded.size,
      setQuickExpanded,
      setConfigExpanded,
    }),
    [quickExpanded, configExpanded, setQuickExpanded, setConfigExpanded],
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

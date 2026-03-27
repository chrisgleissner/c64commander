import * as React from "react";

export type InterstitialSurfaceKind = "modal" | "sheet" | "progress";

type RegisteredInterstitial = {
  id: number;
  kind: InterstitialSurfaceKind;
};

type InterstitialStateContextValue = {
  active: boolean;
  depth: number;
  topKind: InterstitialSurfaceKind | null;
  register: (kind: InterstitialSurfaceKind) => () => void;
};

const defaultContextValue: InterstitialStateContextValue = {
  active: false,
  depth: 0,
  topKind: null,
  register: () => () => undefined,
};

const InterstitialStateContext = React.createContext<InterstitialStateContextValue>(defaultContextValue);

let nextInterstitialId = 1;

export function InterstitialStateProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = React.useState<RegisteredInterstitial[]>([]);

  const register = React.useCallback((kind: InterstitialSurfaceKind) => {
    const id = nextInterstitialId++;
    setStack((current) => [...current, { id, kind }]);

    return () => {
      setStack((current) => current.filter((entry) => entry.id !== id));
    };
  }, []);

  const value = React.useMemo<InterstitialStateContextValue>(() => {
    const top = stack.at(-1) ?? null;
    return {
      active: stack.length > 0,
      depth: stack.length,
      topKind: top?.kind ?? null,
      register,
    };
  }, [register, stack]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    root.dataset.interstitialActive = value.active ? "true" : "false";
    if (value.topKind) {
      root.dataset.interstitialTopKind = value.topKind;
    } else {
      delete root.dataset.interstitialTopKind;
    }

    return () => {
      delete root.dataset.interstitialActive;
      delete root.dataset.interstitialTopKind;
    };
  }, [value.active, value.topKind]);

  return <InterstitialStateContext.Provider value={value}>{children}</InterstitialStateContext.Provider>;
}

const useInterstitialStateContext = () => React.useContext(InterstitialStateContext);

export const useInterstitialActive = () => useInterstitialStateContext().active;

export const useRegisterInterstitial = (kind: InterstitialSurfaceKind, active = true) => {
  const { register } = useInterstitialStateContext();

  React.useEffect(() => {
    if (!active) return undefined;
    return register(kind);
  }, [active, kind, register]);
};

export const useInterstitialDepth = () => useInterstitialStateContext().depth;

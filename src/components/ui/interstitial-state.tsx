import * as React from "react";

import {
  resolveInterstitialBackdropOpacity,
  resolveInterstitialBackdropZIndex,
  resolveInterstitialSurfaceZIndex,
} from "@/components/ui/interstitialStyles";

export type InterstitialSurfaceKind = "modal" | "sheet" | "progress";

type RegisteredInterstitial = {
  id: number;
  kind: InterstitialSurfaceKind;
};

export type RegisteredInterstitialLayer = {
  backdropOpacity: number;
  backdropZIndex: number;
  depth: number;
  id: number;
  isTop: boolean;
  kind: InterstitialSurfaceKind;
  surfaceZIndex: number;
  totalDepth: number;
};

type InterstitialStateContextValue = {
  active: boolean;
  depth: number;
  getLayer: (id: number | null) => RegisteredInterstitialLayer | null;
  topKind: InterstitialSurfaceKind | null;
  register: (kind: InterstitialSurfaceKind) => number;
  unregister: (id: number) => void;
};

const defaultContextValue: InterstitialStateContextValue = {
  active: false,
  depth: 0,
  getLayer: () => null,
  topKind: null,
  register: () => 0,
  unregister: () => undefined,
};

const InterstitialStateContext = React.createContext<InterstitialStateContextValue>(defaultContextValue);

let nextInterstitialId = 1;

export function InterstitialStateProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = React.useState<RegisteredInterstitial[]>([]);

  const register = React.useCallback((kind: InterstitialSurfaceKind) => {
    const id = nextInterstitialId++;
    setStack((current) => [...current, { id, kind }]);
    return id;
  }, []);

  const unregister = React.useCallback((id: number) => {
    setStack((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const value = React.useMemo<InterstitialStateContextValue>(() => {
    const top = stack.at(-1) ?? null;
    const layersById = new Map<number, RegisteredInterstitialLayer>(
      stack.map((entry, index) => {
        const depth = index + 1;
        return [
          entry.id,
          {
            backdropOpacity: resolveInterstitialBackdropOpacity(depth),
            backdropZIndex: resolveInterstitialBackdropZIndex(depth),
            depth,
            id: entry.id,
            isTop: index === stack.length - 1,
            kind: entry.kind,
            surfaceZIndex: resolveInterstitialSurfaceZIndex(depth),
            totalDepth: stack.length,
          },
        ];
      }),
    );

    return {
      active: stack.length > 0,
      depth: stack.length,
      getLayer: (id: number | null) => (id === null ? null : (layersById.get(id) ?? null)),
      topKind: top?.kind ?? null,
      register,
      unregister,
    };
  }, [register, stack, unregister]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    root.dataset.interstitialActive = value.active ? "true" : "false";
    root.dataset.interstitialDepth = `${value.depth}`;
    if (value.topKind) {
      root.dataset.interstitialTopKind = value.topKind;
    } else {
      delete root.dataset.interstitialTopKind;
    }

    return () => {
      delete root.dataset.interstitialActive;
      delete root.dataset.interstitialDepth;
      delete root.dataset.interstitialTopKind;
    };
  }, [value.active, value.depth, value.topKind]);

  return <InterstitialStateContext.Provider value={value}>{children}</InterstitialStateContext.Provider>;
}

const useInterstitialStateContext = () => React.useContext(InterstitialStateContext);

export const useInterstitialActive = () => useInterstitialStateContext().active;

export const useRegisterInterstitial = (kind: InterstitialSurfaceKind, active = true) => {
  const { getLayer, register, unregister } = useInterstitialStateContext();
  const [registrationId, setRegistrationId] = React.useState<number | null>(null);
  const registrationIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!active) {
      setRegistrationId(null);
      return undefined;
    }

    const nextId = register(kind);
    registrationIdRef.current = nextId;
    setRegistrationId(nextId);

    return () => {
      unregister(nextId);
      if (registrationIdRef.current === nextId) {
        registrationIdRef.current = null;
      }
    };
  }, [active, kind, register, unregister]);

  return React.useMemo(() => getLayer(registrationId), [getLayer, registrationId]);
};

export const useInterstitialDepth = () => useInterstitialStateContext().depth;

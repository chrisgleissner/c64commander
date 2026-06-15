import * as React from "react";
import { App } from "@capacitor/app";

import {
  resolveInterstitialBackdropOpacity,
  resolveInterstitialBackdropZIndex,
  resolveInterstitialSurfaceZIndex,
} from "@/components/ui/interstitialStyles";
import { addLog } from "@/lib/logging";

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
  backDismissActive: boolean;
  depth: number;
  getLayer: (id: number | null) => RegisteredInterstitialLayer | null;
  topKind: InterstitialSurfaceKind | null;
  register: (kind: InterstitialSurfaceKind) => number;
  unregister: (id: number) => void;
  registerPopoverBackDismiss: () => void;
  unregisterPopoverBackDismiss: () => void;
};

const defaultContextValue: InterstitialStateContextValue = {
  active: false,
  backDismissActive: false,
  depth: 0,
  getLayer: () => null,
  topKind: null,
  register: () => 0,
  unregister: () => undefined,
  registerPopoverBackDismiss: () => undefined,
  unregisterPopoverBackDismiss: () => undefined,
};

const InterstitialStateContext = React.createContext<InterstitialStateContextValue>(defaultContextValue);

let nextInterstitialId = 1;

export function InterstitialStateProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = React.useState<RegisteredInterstitial[]>([]);
  // Lightweight non-modal poppers (dropdown-menu / select / popover / context-menu) participate in
  // Android-Back dismissal WITHOUT modal surface treatment: they only keep the Capacitor backButton
  // listener alive so Back dispatches Escape (closing the topmost Radix layer) instead of popping the
  // route. They deliberately stay out of the modal `stack` so they do NOT hide the TabBar, make the
  // page inert, render a backdrop, or perturb modal depth/z-index. See BUG-027.
  const [popoverBackDismissCount, setPopoverBackDismissCount] = React.useState(0);

  const register = React.useCallback((kind: InterstitialSurfaceKind) => {
    const id = nextInterstitialId++;
    setStack((current) => [...current, { id, kind }]);
    return id;
  }, []);

  const unregister = React.useCallback((id: number) => {
    setStack((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const registerPopoverBackDismiss = React.useCallback(() => {
    setPopoverBackDismissCount((current) => current + 1);
  }, []);

  const unregisterPopoverBackDismiss = React.useCallback(() => {
    setPopoverBackDismissCount((current) => Math.max(0, current - 1));
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
      backDismissActive: stack.length > 0 || popoverBackDismissCount > 0,
      depth: stack.length,
      getLayer: (id: number | null) => (id === null ? null : (layersById.get(id) ?? null)),
      topKind: top?.kind ?? null,
      register,
      unregister,
      registerPopoverBackDismiss,
      unregisterPopoverBackDismiss,
    };
  }, [popoverBackDismissCount, register, registerPopoverBackDismiss, stack, unregister, unregisterPopoverBackDismiss]);

  const activeInterstitialRef = React.useRef({
    depth: value.depth,
    topKind: value.topKind,
  });
  activeInterstitialRef.current = {
    depth: value.depth,
    topKind: value.topKind,
  };

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

  React.useEffect(() => {
    if (!value.backDismissActive || typeof document === "undefined") {
      return undefined;
    }

    let removed = false;
    let removeListener: (() => Promise<void>) | null = null;

    void App.addListener("backButton", () => {
      const activeInterstitial = activeInterstitialRef.current;
      addLog("debug", "Android Back dismissed topmost interstitial", {
        depth: activeInterstitial.depth,
        topKind: activeInterstitial.topKind,
      });
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );
    })
      .then((handle) => {
        if (removed) {
          void handle.remove();
          return;
        }
        removeListener = () => handle.remove();
      })
      .catch((error) => {
        addLog("warn", "Failed to register Android Back interstitial handler", {
          error: error instanceof Error ? error.message : String(error ?? "Unknown listener failure"),
        });
      });

    return () => {
      removed = true;
      void removeListener?.();
    };
  }, [value.backDismissActive]);

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

/**
 * Register a lightweight non-modal overlay (dropdown-menu / select / popover / context-menu) as an
 * Android-Back dismiss participant while `active` is true.
 * Unlike `useRegisterInterstitial`, this does NOT add modal surface treatment (no backdrop, no TabBar
 * hide, no page inert, no depth/z-index change) — it only keeps the Capacitor backButton listener alive
 * so Back dispatches Escape (dismissing the topmost Radix layer) instead of popping the route. See BUG-027.
 *
 * IMPORTANT: pass the overlay's actual OPEN state as `active`. Do NOT call this unconditionally from a
 * Radix `*Content` wrapper: those wrappers render for the whole lifetime of their parent, and Radix
 * `Select.Content` even renders its children into an off-screen DocumentFragment while CLOSED — either
 * would keep the listener alive when the overlay is shut, trapping Android Back at tab roots (BUG-028).
 * Prefer `usePopoverBackDismissRoot`, which derives the open state from the Radix Root's `onOpenChange`.
 */
export const usePopoverBackDismiss = (active = true) => {
  const { registerPopoverBackDismiss, unregisterPopoverBackDismiss } = useInterstitialStateContext();

  React.useEffect(() => {
    if (!active) return undefined;

    registerPopoverBackDismiss();
    return () => {
      unregisterPopoverBackDismiss();
    };
  }, [active, registerPopoverBackDismiss, unregisterPopoverBackDismiss]);
};

/**
 * Track a Radix overlay Root's open state (controlled or uncontrolled) and keep the Android-Back→Escape
 * dismissal listener alive only WHILE it is open. Wrap the Radix `*Root` and spread the returned
 * `open`/`onOpenChange` onto it (for context-menu, which has no controllable `open`, use only
 * `onOpenChange`).
 *
 * This must register against the Root's logical open state — NOT a child mounted inside `*Content` —
 * because Radix `Select.Content` renders `children` into an off-screen DocumentFragment even while the
 * select is CLOSED (for its Collection/measurement), so a child participant would register permanently
 * (BUG-028). The Root's `onOpenChange` fires exactly on open/close, so registration tracks the real
 * lifecycle and unregisters immediately on close (no animation/unmount race). See BUG-027/BUG-028.
 */
export const usePopoverBackDismissRoot = ({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}): { open: boolean | undefined; onOpenChange: (open: boolean) => void } => {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  usePopoverBackDismiss(isOpen);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  return { open: controlledOpen, onOpenChange: handleOpenChange };
};

export const useInterstitialDepth = () => useInterstitialStateContext().depth;

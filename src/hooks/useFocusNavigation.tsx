/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * React adapter that drives keyboard-only (D-pad + center) navigation from real
 * key events, for keypad-first devices (touch disabled).
 *
 * The pure logic lives in `@/lib/input`: {@link NavigationController} turns a
 * semantic action into a focus move / activate / back-chain step over an ordered
 * registry, and {@link normalizeKeyEvent} maps a raw key event to that action via
 * the active input profile. This file is the thin, DOM-aware glue:
 *
 *   - {@link FocusNavigationProvider} mounts ONE global `keydown` listener,
 *     normalizes each event through the active profile's keymap, dispatches the
 *     action, and applies the DOM side-effects the pure layer cannot: focusing
 *     the resolved element and calling back to the router on an exhausted `back`.
 *   - {@link useFocusItem} registers a CTA's element (and an optional explicit
 *     activation) into the controller for the lifetime of the component, so
 *     d-pad traversal and center-activation reach it in a deterministic order.
 *
 * It is additive: with no items registered the dispatcher resolves everything to
 * `ignored`, so the listener never calls `preventDefault` and existing
 * pointer/touch behaviour is untouched. Keys are not stolen from an engaged text
 * field — events whose target is editable are left for the field (and its
 * `useT9Input` composer) to handle.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefCallback,
} from "react";

import { NavigationController, normalizeKeyEvent, resolveInputProfile, type FocusItem } from "@/lib/input";

interface FocusNavigationContextValue {
  readonly controller: NavigationController;
  /** Registers an item and a lazy resolver for its current DOM element. */
  readonly register: (item: FocusItem, resolveElement: () => HTMLElement | null) => void;
  readonly unregister: (id: string) => void;
}

const FocusNavigationContext = createContext<FocusNavigationContextValue | null>(null);

/**
 * True when the event target is a text-editing element. Global navigation skips
 * these so digits/arrows reach the field (and its T9 composer) instead of being
 * consumed for focus movement.
 */
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // Fall back to the attribute: some engines (and jsdom) don't compute
  // `isContentEditable`, but `contenteditable` / `contenteditable="true"` is set.
  const editableAttr = target.getAttribute("contenteditable");
  return editableAttr !== null && editableAttr !== "false";
};

export interface FocusNavigationProviderProps {
  readonly children: ReactNode;
  /** Input profile id selecting the active keymap (e.g. "keypad"). */
  readonly profileId?: string | null;
  /** Called when the `back` chain is exhausted (adapter wires this to router back). */
  readonly onNavigateBack?: () => void;
  /** When false the global listener is detached (the registry still works programmatically). */
  readonly enabled?: boolean;
}

export const FocusNavigationProvider = ({
  children,
  profileId,
  onNavigateBack,
  enabled = true,
}: FocusNavigationProviderProps) => {
  const resolversRef = useRef(new Map<string, () => HTMLElement | null>());
  const onNavigateBackRef = useRef(onNavigateBack);
  onNavigateBackRef.current = onNavigateBack;

  const controller = useMemo(
    () =>
      new NavigationController({
        callbacks: {
          onFocus: (item) => resolversRef.current.get(item.id)?.()?.focus(),
          onNavigateBack: () => onNavigateBackRef.current?.(),
        },
      }),
    [],
  );

  const register = useCallback<FocusNavigationContextValue["register"]>(
    (item, resolveElement) => {
      resolversRef.current.set(item.id, resolveElement);
      controller.focus.register(item);
    },
    [controller],
  );

  const unregister = useCallback<FocusNavigationContextValue["unregister"]>(
    (id) => {
      resolversRef.current.delete(id);
      controller.focus.unregister(id);
    },
    [controller],
  );

  const keymap = useMemo(() => resolveInputProfile(profileId), [profileId]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const { action } = normalizeKeyEvent(event, keymap);
      if (action === null) return;
      if (controller.dispatch(action).type !== "ignored") {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controller, enabled, keymap]);

  const value = useMemo<FocusNavigationContextValue>(
    () => ({ controller, register, unregister }),
    [controller, register, unregister],
  );

  return <FocusNavigationContext.Provider value={value}>{children}</FocusNavigationContext.Provider>;
};

/** The active {@link NavigationController}, or `null` outside a provider (e.g. to push dismissible layers). */
export const useFocusNavigation = (): NavigationController | null =>
  useContext(FocusNavigationContext)?.controller ?? null;

export interface UseFocusItemOptions {
  /**
   * Stable, unique id for this CTA within the screen. An empty string opts the
   * caller out of registration (the returned ref still tracks the element), so a
   * shared primitive can call this hook unconditionally and only join the focus
   * ring when a real id is supplied.
   */
  readonly id: string;
  /** Lower sorts earlier in d-pad traversal; ties broken by registration order. */
  readonly order: number;
  readonly group?: string;
  /** Disabled items are skipped during traversal and refuse activation. */
  readonly disabled?: boolean;
  /** Custom activation; defaults to clicking the registered element. */
  readonly onActivate?: () => void;
}

/**
 * Registers a CTA with the surrounding {@link FocusNavigationProvider} and
 * returns a `ref` callback to attach to its DOM element. No-op outside a
 * provider (or when `id` is empty), so a component using it is safe to render
 * anywhere.
 */
export function useFocusItem<T extends HTMLElement = HTMLElement>(options: UseFocusItemOptions): RefCallback<T> {
  const { id, order, group, disabled = false, onActivate } = options;
  const context = useContext(FocusNavigationContext);
  const elementRef = useRef<T | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  useEffect(() => {
    if (!context || !id) return;
    context.register(
      {
        id,
        order,
        group,
        disabled,
        activate: () => {
          const handler = onActivateRef.current;
          if (handler) {
            handler();
          } else {
            elementRef.current?.click();
          }
        },
      },
      () => elementRef.current,
    );
    return () => context.unregister(id);
  }, [context, id, order, group, disabled]);

  return useCallback((element: T | null) => {
    elementRef.current = element;
  }, []);
}

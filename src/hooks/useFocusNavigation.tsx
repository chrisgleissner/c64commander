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

import {
  NavigationController,
  getInputModality,
  normalizeKeyEvent,
  resolveInputProfile,
  setInputModality,
  subscribeInputModality,
  type DismissibleLayer,
  type FocusItem,
  type Keymap,
} from "@/lib/input";
import { emitKeyInputDiagnostics } from "@/lib/diagnostics/keyInputDiagnostics";

/** DOM attribute marking the current focus-ring item while in key-navigation modality. */
const KEY_SELECTED_ATTR = "data-key-selected";

interface FocusNavigationContextValue {
  readonly controller: NavigationController;
  /** Registers an item and a lazy resolver for its current DOM element. */
  readonly register: (item: FocusItem, resolveElement: () => HTMLElement | null) => void;
  readonly unregister: (id: string) => void;
  /** Whether the global key listener is active (the `keypad_input_enabled` flag). */
  readonly enabled: boolean;
  /** Active keymap, so a focused widget (e.g. a slider) can normalize its own keys. */
  readonly keymap: Keymap;
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
  // `enabled` mirrors `keypad_input_enabled`; read it from a ref inside the
  // window listeners so the highlight gate always sees the current flag value.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // The element currently carrying `data-key-selected`, tracked imperatively so
  // the highlight toggle never goes through React state (HAZARD 3 — avoids the
  // known setState-in-effect coverage hang).
  const selectedElementRef = useRef<HTMLElement | null>(null);

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

  /**
   * Applies the selected-control highlight imperatively: `data-key-selected` sits
   * on exactly the current focus-ring item's element, iff the flag is on AND
   * modality is `key-navigation`. Moves to the new element and clears the old one
   * on every change; clears entirely otherwise (flag off / pointer modality).
   */
  const refreshHighlight = useCallback(() => {
    const shouldShow = enabledRef.current && getInputModality() === "key-navigation";
    const currentId = controller.focus.current()?.id;
    const nextElement = shouldShow && currentId ? (resolversRef.current.get(currentId)?.() ?? null) : null;
    const previousElement = selectedElementRef.current;
    if (previousElement && previousElement !== nextElement) {
      previousElement.removeAttribute(KEY_SELECTED_ATTR);
    }
    if (nextElement) {
      nextElement.setAttribute(KEY_SELECTED_ATTR, "true");
    }
    selectedElementRef.current = nextElement;
  }, [controller]);

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
      // The highlighted item may have just unmounted; re-derive the attribute.
      refreshHighlight();
    },
    [controller, refreshHighlight],
  );

  const keymap = useMemo(() => resolveInputProfile(profileId), [profileId]);

  // Re-apply the highlight whenever modality flips (key press, slider key
  // adjust, T9 composer key, or a pointer touch flipping back to `pointer`).
  useEffect(() => subscribeInputModality(refreshHighlight), [refreshHighlight]);

  useEffect(() => {
    if (!enabled) {
      // Flag turned off: drop any lingering highlight and reset modality so the
      // app returns to the byte-for-byte baseline.
      if (selectedElementRef.current) {
        selectedElementRef.current.removeAttribute(KEY_SELECTED_ATTR);
        selectedElementRef.current = null;
      }
      setInputModality("pointer");
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const normalized = normalizeKeyEvent(event, keymap);
      const { action } = normalized;
      // Never touch editable targets (the field + its T9 composer own them); and
      // never log them, so typed text is never captured by diagnostics.
      if (isEditableTarget(event.target)) return;
      // NB: we intentionally do NOT bail on `event.defaultPrevented`. A focused
      // slider `preventDefault`s Up/Down to suppress Radix's value step while
      // STILL relying on this handler to move focus; HAZARD 2 (open dropdowns)
      // is handled by the controller's layer guard, not here.
      const activeElement = document.activeElement;
      if (action === null) {
        // Unmapped key on a navigable target — log raw fields so a binding can
        // be added from an export. Never silently dropped.
        emitKeyInputDiagnostics({
          rawEvent: event,
          normalizedAction: null,
          handled: false,
          ignoredReason: "no-binding",
          preventDefaultApplied: false,
          keypadEnabled: enabledRef.current,
          modality: getInputModality(),
          selectedControlId: controller.focus.current()?.id ?? null,
          activeElement,
        });
        return;
      }
      // A deeper open layer (e.g. a Radix popup's own document-level Escape
      // handler, which `preventDefault`s) may have already consumed a dismissal
      // key. Do NOT also run the global back chain — it could `navigate(-1)` once
      // the layer has already closed itself. Scoped to back/escape so a slider's
      // Up/Down `preventDefault` (dpad actions) still moves focus normally.
      if (event.defaultPrevented && (action === "back" || action === "escape")) {
        return;
      }
      const handled = controller.dispatch(action).type !== "ignored";
      if (handled) {
        // A recognized key produced an effect → key-navigation modality + the
        // selected-control highlight (refreshHighlight reads the new current item).
        setInputModality("key-navigation");
        refreshHighlight();
        event.preventDefault();
      }
      emitKeyInputDiagnostics({
        rawEvent: event,
        normalizedAction: action,
        handled,
        ignoredReason: handled ? undefined : "ignored-by-controller",
        preventDefaultApplied: handled,
        keypadEnabled: enabledRef.current,
        modality: getInputModality(),
        selectedControlId: controller.focus.current()?.id ?? null,
        activeElement,
      });
    };
    // Pointer/touch always wins: capture-phase so it flips modality (and clears
    // the highlight via the subscription) before any other handler runs.
    const handlePointer = () => setInputModality("pointer");
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointer, true);
    window.addEventListener("touchstart", handlePointer, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointer, true);
      window.removeEventListener("touchstart", handlePointer, true);
    };
  }, [controller, enabled, keymap, refreshHighlight]);

  const value = useMemo<FocusNavigationContextValue>(
    () => ({ controller, register, unregister, enabled, keymap }),
    [controller, register, unregister, enabled, keymap],
  );

  return <FocusNavigationContext.Provider value={value}>{children}</FocusNavigationContext.Provider>;
};

/** The active {@link NavigationController}, or `null` outside a provider (e.g. to push dismissible layers). */
export const useFocusNavigation = (): NavigationController | null =>
  useContext(FocusNavigationContext)?.controller ?? null;

/**
 * The full focus-navigation context (controller + `enabled` flag + active
 * keymap), or `null` outside a provider. Used by focused widgets that own their
 * own keys (e.g. sliders) and need to know whether keypad nav is active.
 */
export const useFocusNavigationContext = (): FocusNavigationContextValue | null => useContext(FocusNavigationContext);

let dismissibleLayerSeq = 0;

/**
 * Registers an open overlay (Radix Select/dropdown/popover) as a dismissible
 * layer on the {@link NavigationController} while `open` is true and keypad
 * navigation is enabled. The layer guard then makes the open widget — not the
 * underlying focus ring — own vertical/activate keys (HAZARD 2), and keypad
 * `back` (keyCode 4, which Radix ignores) closes it via `dismiss`.
 *
 * No-op outside a provider or when the flag is off, so it never perturbs the
 * baseline (the controller's key listener is detached then anyway).
 */
export const useDismissibleNavigationLayer = (
  open: boolean,
  { kind = "popup", dismiss }: { kind?: DismissibleLayer["kind"]; dismiss: () => void },
): void => {
  const context = useContext(FocusNavigationContext);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const idRef = useRef<string>("");
  if (!idRef.current) {
    idRef.current = `nav-layer-${(dismissibleLayerSeq += 1)}`;
  }

  const controller = context?.controller ?? null;
  const enabled = context?.enabled ?? false;

  useEffect(() => {
    if (!controller || !enabled || !open) return;
    const id = idRef.current;
    controller.pushLayer({ id, kind, dismiss: () => dismissRef.current() });
    return () => controller.removeLayer(id);
  }, [controller, enabled, open, kind]);
};

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
  /** Optional parent focus item id for nested card / hierarchical CTA traversal. */
  readonly parentId?: string;
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
  const { id, order, group, parentId, disabled = false, onActivate } = options;
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
        parentId,
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
  }, [context, id, order, group, parentId, disabled]);

  return useCallback((element: T | null) => {
    elementRef.current = element;
  }, []);
}

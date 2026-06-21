/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * React adapter that drives keyboard / D-pad / keypad navigation from real key
 * events, for keypad-first devices (and any hardware keyboard).
 *
 * The pure logic lives in `@/lib/input`: {@link NavigationController} turns a
 * semantic action into a focus move / descend / activate / back-chain step over
 * an ordered registry, {@link FocusDiscoveryEngine} keeps that registry in sync
 * with the live DOM of the active scope (so reachability is complete by
 * construction — every interactive element is in the ring without per-component
 * wiring), and {@link normalizeKeyEvent} maps a raw key event to a semantic
 * action via the active profile. This file is the thin, DOM-aware glue:
 *
 *   - {@link FocusNavigationProvider} mounts ONE global capture-phase `keydown`
 *     listener + capture pointer/touch listeners (which flip modality), runs the
 *     discovery engine while the flag is on, and applies the DOM side-effects the
 *     pure layer cannot (focus the resolved element, scroll it into view, toggle
 *     the highlight, call the router on an exhausted Back, open a context menu).
 *   - {@link useFocusItem} / {@link useFocusGroup} are OPTIONAL refinements:
 *     they give an element an explicit id / order / group membership / custom
 *     activation / opt-out. Basic reachability needs neither.
 *
 * Prime Directive: with the flag OFF the engine never starts, no `tabindex` or
 * other attribute is written, no key is `preventDefault`ed, and modality stays
 * `pointer` — the app is byte-for-byte baseline. With the flag ON but modality
 * `pointer`, there is still no highlight and no guidance bar; a pointer/touch
 * always wins and clears both in the same frame.
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
  CONTEXT_MENU_SELECTOR,
  FocusDiscoveryEngine,
  NavigationController,
  getInputModality,
  isHorizontalKeyOwner,
  normalizeKeyEvent,
  resolveInputProfile,
  setInputModality,
  subscribeInputModality,
  type DismissibleLayer,
  type FocusDescriptor,
  type FocusItem,
  type Keymap,
} from "@/lib/input";
import { emitKeyInputDiagnostics } from "@/lib/diagnostics/keyInputDiagnostics";
import { KeypadGuidanceBar } from "@/components/input/KeypadGuidanceBar";

/** DOM attribute marking the current focus-ring item while in key-navigation modality. */
const KEY_SELECTED_ATTR = "data-key-selected";
/** DOM attribute outlining the enclosing group while the ring is descended inside it. */
const KEY_SCOPE_ATTR = "data-key-scope";

export interface FocusNavigationContextValue {
  readonly controller: NavigationController;
  readonly engine: FocusDiscoveryEngine;
  /** Registers an explicit refinement (id / order / group / activation / opt-out). */
  readonly registerDescriptor: (descriptor: FocusDescriptor, resolveElement: () => HTMLElement | null) => void;
  readonly unregisterDescriptor: (id: string) => void;
  /** Asks the engine to re-scan (e.g. after an element ref attaches). */
  readonly scheduleRefresh: () => void;
  /** Subscribe to ring/scope/modality changes (the guidance bar mirrors this imperatively). */
  readonly subscribeRingChange: (listener: () => void) => () => void;
  /** Whether the global key listener + discovery engine are active (the flag). */
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
  const editableAttr = target.getAttribute("contenteditable");
  return editableAttr !== null && editableAttr !== "false";
};

/**
 * Radix overlays (dialog, alert dialog, dropdown/context menu, select listbox,
 * popover) own the keyboard while focus is inside them. The global focus ring
 * sits behind them, so it must stay inert there (HAZARD 2). The discovery engine
 * already switches scope to the open overlay, but app dialogs that do not push a
 * controller layer still need this guard so an Enter never reaches a CTA behind.
 */
const OPEN_OVERLAY_ANCESTOR_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]';
const isWithinOpenOverlay = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(OPEN_OVERLAY_ANCESTOR_SELECTOR) !== null;

/**
 * True for elements the browser activates natively on Enter/Space. When such an
 * element holds DOM focus via Tab / programmatic focus / assistive tech (i.e. not
 * through the ring, which would also `element.focus()` its current item), the
 * browser owns activation — the global ring must not fire its own current item.
 */
const isNativelyActivatable = (element: Element): boolean => {
  const tag = element.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY") return true;
  if (tag === "A") return element.hasAttribute("href");
  return false;
};

const focusRingElement = (element: HTMLElement | null): void => {
  if (!element) return;
  // Keep the focused control fully visible: reserve space for the fixed header
  // (top) and the guidance bar + tab bar (bottom) so `scrollIntoView` never parks
  // the control beneath the app chrome. `preventScroll` on focus lets the
  // margin-aware `scrollIntoView` own the scroll instead of the browser's default
  // focus scroll (which ignores scroll-margin).
  element.style.setProperty("scroll-margin-top", "var(--keypad-scroll-margin-top)");
  element.style.setProperty("scroll-margin-bottom", "var(--keypad-scroll-margin-bottom)");
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
};

export interface FocusNavigationProviderProps {
  readonly children: ReactNode;
  /** Input profile id selecting the active keymap (e.g. "keypad"). */
  readonly profileId?: string | null;
  /** Called when the `back` chain is exhausted (adapter wires this to router back). */
  readonly onNavigateBack?: () => void;
  /** When false the engine + global listener are detached (byte-for-byte baseline). */
  readonly enabled?: boolean;
}

export const FocusNavigationProvider = ({
  children,
  profileId,
  onNavigateBack,
  enabled = true,
}: FocusNavigationProviderProps) => {
  const descriptorsRef = useRef(
    new Map<string, { descriptor: FocusDescriptor; resolveElement: () => HTMLElement | null }>(),
  );
  const onNavigateBackRef = useRef(onNavigateBack);
  onNavigateBackRef.current = onNavigateBack;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // The element currently carrying `data-key-selected`, tracked imperatively so
  // the highlight toggle never goes through React state (avoids the known
  // setState-in-effect coverage hang).
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const scopeElementRef = useRef<HTMLElement | null>(null);
  const ringListenersRef = useRef(new Set<() => void>());
  const engineRef = useRef<FocusDiscoveryEngine | null>(null);

  const openContextMenuFor = useCallback((element: HTMLElement | null): boolean => {
    if (!element) return false;
    const host = element.closest("[data-key-nav-menu-host]") ?? element;
    const trigger = element.matches(CONTEXT_MENU_SELECTOR)
      ? element
      : (host.querySelector(CONTEXT_MENU_SELECTOR) as HTMLElement | null);
    if (trigger instanceof HTMLElement) {
      trigger.click();
      return true;
    }
    return false;
  }, []);

  const controller = useMemo(
    () =>
      new NavigationController({
        callbacks: {
          onFocus: (item) => focusRingElement(engineRef.current?.elementForId(item.id) ?? null),
          // After activation, keep the ring element focused — BUT respect an
          // activation that intentionally moved focus into the item's own subtree
          // (the field-row pattern focuses its inner <input> for editing). Yanking
          // focus back to the row there would break OK-to-edit; the synchronous
          // `contains` check lets that focus stand while still re-anchoring a plain
          // button/control that did not move focus.
          onActivate: (item) => {
            const element = engineRef.current?.elementForId(item.id) ?? null;
            if (element && element.contains(document.activeElement)) return;
            focusRingElement(element);
          },
          onNavigateBack: () => onNavigateBackRef.current?.(),
          onOpenMenu: (item) => openContextMenuFor(item ? (engineRef.current?.elementForId(item.id) ?? null) : null),
        },
      }),
    [openContextMenuFor],
  );

  /**
   * Applies the selected-control highlight imperatively: `data-key-selected` sits
   * on exactly the current ring item, and `data-key-scope` outlines the enclosing
   * group while descended — both iff the flag is on AND modality is
   * `key-navigation`. Cleared entirely otherwise (flag off / pointer modality).
   */
  const refreshHighlight = useCallback(() => {
    const shouldShow = enabledRef.current && getInputModality() === "key-navigation";
    const engine = engineRef.current;
    const currentId = controller.focus.current()?.id;
    const nextElement = shouldShow && currentId ? (engine?.elementForId(currentId) ?? null) : null;

    const previous = selectedElementRef.current;
    if (previous && previous !== nextElement) previous.removeAttribute(KEY_SELECTED_ATTR);
    if (nextElement) nextElement.setAttribute(KEY_SELECTED_ATTR, "true");
    selectedElementRef.current = nextElement;

    // Outline the innermost group the ring is currently inside (the descended card).
    const scopeId = controller.focus.currentScopeParentId();
    const nextScope = shouldShow && scopeId ? (engine?.elementForId(scopeId) ?? null) : null;
    const previousScope = scopeElementRef.current;
    if (previousScope && previousScope !== nextScope) previousScope.removeAttribute(KEY_SCOPE_ATTR);
    if (nextScope && nextScope !== nextElement) nextScope.setAttribute(KEY_SCOPE_ATTR, "true");
    scopeElementRef.current = nextScope;
  }, [controller]);

  const notifyRing = useCallback(() => {
    refreshHighlight();
    ringListenersRef.current.forEach((listener) => listener());
  }, [refreshHighlight]);

  const engine = useMemo(
    () =>
      new FocusDiscoveryEngine({
        controller: controller.focus,
        listExplicit: () => Array.from(descriptorsRef.current.values()),
        freezeDuringTransientLayer: () => controller.layerDepth > 0,
        onAfterAssemble: () => notifyRing(),
      }),
    [controller, notifyRing],
  );
  engineRef.current = engine;

  const registerDescriptor = useCallback<FocusNavigationContextValue["registerDescriptor"]>(
    (descriptor, resolveElement) => {
      descriptorsRef.current.set(descriptor.id, { descriptor, resolveElement });
      engineRef.current?.scheduleRefresh();
    },
    [],
  );

  const unregisterDescriptor = useCallback<FocusNavigationContextValue["unregisterDescriptor"]>((id) => {
    descriptorsRef.current.delete(id);
    engineRef.current?.scheduleRefresh();
  }, []);

  const scheduleRefresh = useCallback(() => engineRef.current?.scheduleRefresh(), []);

  const subscribeRingChange = useCallback<FocusNavigationContextValue["subscribeRingChange"]>((listener) => {
    ringListenersRef.current.add(listener);
    return () => {
      ringListenersRef.current.delete(listener);
    };
  }, []);

  const keymap = useMemo(() => resolveInputProfile(profileId), [profileId]);

  // Re-apply the highlight + notify the guidance bar whenever modality flips.
  useEffect(() => subscribeInputModality(notifyRing), [notifyRing]);

  // Run the discovery engine only while the flag is on (Prime Directive).
  useEffect(() => {
    if (!enabled) return;
    engine.start();
    return () => engine.stop();
  }, [enabled, engine]);

  /**
   * On the first key after pointer use, adopt whatever the pointer last focused
   * (or the current `document.activeElement`) as the ring's current item, so the
   * highlight appears WHERE THE USER IS rather than jumping to the top of the ring.
   */
  const adoptActiveElement = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    for (const item of controller.focus.list()) {
      const element = engineRef.current?.elementForId(item.id);
      if (element && (element === active || element.contains(active))) {
        controller.focus.setCurrent(item.id);
        return;
      }
    }
  }, [controller]);

  useEffect(() => {
    if (!enabled) {
      // Flag turned off: drop any lingering highlight / scope outline and reset
      // modality so the app returns to the byte-for-byte baseline.
      if (selectedElementRef.current) {
        selectedElementRef.current.removeAttribute(KEY_SELECTED_ATTR);
        selectedElementRef.current = null;
      }
      if (scopeElementRef.current) {
        scopeElementRef.current.removeAttribute(KEY_SCOPE_ATTR);
        scopeElementRef.current = null;
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
      // While focus is inside an open Radix overlay, that overlay owns the key.
      if (isWithinOpenOverlay(event.target)) return;
      const activeElement = document.activeElement;
      // Left/Right belong to a focused value control (slider / tabs / segmented /
      // radio). Capture runs before the widget's bubble handler, so we bow out
      // here (no dispatch, no preventDefault) and let the widget own them; they
      // only fall back to sibling navigation when nothing owns horizontal. The
      // event TARGET is where the key is headed (it equals the focused element in
      // a real browser), so it is the right thing to test.
      if (
        (action === "dpadLeft" || action === "dpadRight") &&
        (isHorizontalKeyOwner(event.target as Element | null) || isHorizontalKeyOwner(activeElement))
      ) {
        return;
      }
      if (action === null) {
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
      // A deeper open layer (e.g. a Radix popup's document-level Escape handler)
      // may have already consumed a dismissal key; do NOT also run the back chain.
      if (event.defaultPrevented && (action === "back" || action === "escape" || action === "softLeft")) {
        return;
      }
      // Defer activation to a real focused control outside the ring (invariant 3).
      if (
        (action === "enter" || action === "center" || action === "activate") &&
        activeElement instanceof HTMLElement &&
        isNativelyActivatable(activeElement) &&
        activeElement !== (engineRef.current?.elementForId(controller.focus.current()?.id ?? "") ?? null)
      ) {
        return;
      }
      // Seamless pointer → key hand-off: start the move from where the user is.
      if (getInputModality() === "pointer") adoptActiveElement();

      const handled = controller.dispatch(action).type !== "ignored";
      if (handled) {
        setInputModality("key-navigation");
        notifyRing();
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
    // the highlight + guidance bar via the subscription) before any other handler.
    const handlePointer = () => setInputModality("pointer");
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointer, true);
    window.addEventListener("touchstart", handlePointer, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointer, true);
      window.removeEventListener("touchstart", handlePointer, true);
    };
  }, [adoptActiveElement, controller, enabled, keymap, notifyRing]);

  const value = useMemo<FocusNavigationContextValue>(
    () => ({
      controller,
      engine,
      registerDescriptor,
      unregisterDescriptor,
      scheduleRefresh,
      subscribeRingChange,
      enabled,
      keymap,
    }),
    [
      controller,
      engine,
      registerDescriptor,
      unregisterDescriptor,
      scheduleRefresh,
      subscribeRingChange,
      enabled,
      keymap,
    ],
  );

  return (
    <FocusNavigationContext.Provider value={value}>
      {children}
      <KeypadGuidanceBar />
    </FocusNavigationContext.Provider>
  );
};

/** The active {@link NavigationController}, or `null` outside a provider. */
export const useFocusNavigation = (): NavigationController | null =>
  useContext(FocusNavigationContext)?.controller ?? null;

/**
 * The full focus-navigation context (controller + engine + `enabled` flag +
 * active keymap), or `null` outside a provider. Used by focused widgets that own
 * their own keys (e.g. sliders) and by the guidance bar.
 */
export const useFocusNavigationContext = (): FocusNavigationContextValue | null => useContext(FocusNavigationContext);

let dismissibleLayerSeq = 0;

/**
 * Registers an open overlay (Radix Select/dropdown/popover) as a dismissible
 * layer on the {@link NavigationController} while `open` is true and the flag is
 * on. The layer guard then makes the open widget — not the underlying focus ring
 * — own vertical/activate keys (HAZARD 2), and keypad `back` (keyCode 4) closes
 * it via `dismiss`.
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
   * shared primitive can call this hook unconditionally and only refine the focus
   * ring when a real id is supplied.
   */
  readonly id: string;
  /** Tiebreaker only — the ring is DOM-ordered; supply when DOM order is wrong. */
  readonly order?: number;
  /** Free-text/scope label (surfaced in the breadcrumb when this is a group). */
  readonly group?: string;
  /** Explicit parent focus id (normally inferred from DOM containment). */
  readonly parentId?: string;
  /** Disabled items are skipped during traversal and refuse activation. */
  readonly disabled?: boolean;
  /** Remove this element from the ring entirely. */
  readonly skip?: boolean;
  /** Custom activation; defaults to clicking the registered element. */
  readonly onActivate?: () => void;
}

const useDescriptorRegistration = (
  descriptor: FocusDescriptor | null,
  elementRef: React.MutableRefObject<HTMLElement | null>,
): RefCallback<HTMLElement> => {
  const context = useContext(FocusNavigationContext);
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;

  // Re-register whenever the stable parts of the descriptor change.
  const id = descriptor?.id ?? "";
  const order = descriptor?.order;
  const group = descriptor?.group;
  const label = descriptor?.label;
  const parentId = descriptor?.parentId;
  const disabled = descriptor?.disabled;
  const skip = descriptor?.skip;
  const kind = descriptor?.kind;

  useEffect(() => {
    if (!context || !id) return;
    const current = descriptorRef.current;
    if (!current) return;
    context.registerDescriptor(
      {
        ...current,
        // Stable activate closure: always read the latest from the descriptor ref.
        activate: () => descriptorRef.current?.activate?.(),
      },
      () => elementRef.current,
    );
    return () => context.unregisterDescriptor(id);
  }, [context, id, order, group, label, parentId, disabled, skip, kind]);

  return useCallback(
    (element: HTMLElement | null) => {
      elementRef.current = element;
      context?.scheduleRefresh();
    },
    [context],
  );
};

/**
 * Refines a CTA in the focus ring: explicit id / order / group membership /
 * custom activation / opt-out. Reachability does NOT require it — auto-discovery
 * already puts every interactive element in the ring. No-op outside a provider or
 * when `id` is empty.
 */
export function useFocusItem<T extends HTMLElement = HTMLElement>(options: UseFocusItemOptions): RefCallback<T> {
  const { id, order, group, parentId, disabled = false, skip = false, onActivate } = options;
  const elementRef = useRef<HTMLElement | null>(null);
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const descriptor = useMemo<FocusDescriptor | null>(
    () =>
      id
        ? {
            id,
            kind: "item",
            order,
            group,
            parentId,
            disabled,
            skip,
            activate: () => {
              const handler = onActivateRef.current;
              if (handler) handler();
              else elementRef.current?.click();
            },
          }
        : null,
    [id, order, group, parentId, disabled, skip],
  );

  return useDescriptorRegistration(descriptor, elementRef) as RefCallback<T>;
}

export interface UseFocusGroupOptions {
  /** Stable, unique id for this group (used as the breadcrumb segment id). */
  readonly id: string;
  /** Human label for the breadcrumb (e.g. "Audio Mixer"). */
  readonly label?: string;
  /** Tiebreaker only — groups sort by DOM order. */
  readonly order?: number;
  readonly disabled?: boolean;
}

/**
 * Declares a card/section/dialog-region a focus GROUP: its discovered descendants
 * become its children automatically (no per-CTA `parentId`), so OK descends into
 * it and Back ascends. Attach the returned ref to the container element.
 */
export function useFocusGroup<T extends HTMLElement = HTMLElement>(options: UseFocusGroupOptions): RefCallback<T> {
  const { id, label, order, disabled = false } = options;
  const elementRef = useRef<HTMLElement | null>(null);
  const descriptor = useMemo<FocusDescriptor | null>(
    () => (id ? { id, kind: "group", label, group: label, order, disabled } : null),
    [id, label, order, disabled],
  );
  return useDescriptorRegistration(descriptor, elementRef) as RefCallback<T>;
}

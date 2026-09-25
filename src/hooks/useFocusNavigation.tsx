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
  FocusDiscoveryEngine,
  NavigationController,
  digitForAction,
  findContextMenuTrigger,
  getInputModality,
  isHorizontalKeyOwner,
  normalizeKeyEvent,
  SKIP_ATTR,
  setInputModality,
  subscribeInputModality,
  type DismissibleLayer,
  type FocusDescriptor,
  type Keymap,
} from "@/lib/input";
import { useInputProfile } from "@/hooks/useInputProfile";
import { emitKeyInputDiagnostics } from "@/lib/diagnostics/keyInputDiagnostics";
import { KeypadGuidanceBar } from "@/components/input/KeypadGuidanceBar";
import {
  isAnyOverlayOpen,
  isEditableTarget,
  isSingleLineField,
  OPEN_OVERLAY_ANCESTOR_SELECTOR,
} from "@/lib/input/eventTargets";
import { isDeviceBackKey } from "@/lib/input/keyEvent";
import { installDeviceBackButton } from "@/lib/input/deviceBackButton";
import {
  DIALOG_ANCESTOR_SELECTOR,
  ENTER_IGNORING_CONTROL_SELECTOR,
  focusRingElement,
  isNativelyActivatable,
  isWithinOpenOverlay,
  stepFocusWithinOverlay,
} from "@/lib/input/ringDom";
import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { TOUR_ACTIVE_ATTRIBUTE } from "@/lib/tour/tourState";

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
 * Always-reachable global commands a keypad user can fire from anywhere (when not
 * editing text and not inside an open overlay). Wired by the app shell so the
 * provider stays router/UI-agnostic. Phone-keypad idiom: digits 1–N jump to a
 * tab, ✱ opens Diagnostics, # opens the Device Switcher, and the Menu key (when
 * the focused item has no context menu) opens the quick menu.
 */
export interface KeypadShortcutHandlers {
  /** Jump to a primary tab by 0-based index (digits 1–6). */
  readonly jumpToTab?: (index: number) => void;
  /** Open Diagnostics (✱). */
  readonly openDiagnostics?: () => void;
  /** Open the Device Switcher (#) — keypad equivalent of long-pressing the status badge. */
  readonly openDeviceSwitcher?: () => void;
  /** Open the keypad quick menu (Menu-key fallback when the item has no context menu). */
  readonly openQuickMenu?: () => void;
  /** Enter Game Mode (0) — one keystroke from anywhere to the playing state. */
  readonly openGameMode?: () => void;
  /** Run a persisted normal-navigation F1/F3 assignment. */
  readonly runFunctionShortcut?: (key: 1 | 3) => void;
  /** Pause or resume the machine (8) — ten presses away through Home's grid. */
  readonly machinePauseResume?: () => void;
  /** Reset the machine (9), which still asks before it runs. */
  readonly machineReset?: () => void;
}

export interface FocusNavigationProviderProps {
  readonly children: ReactNode;
  /** Input profile id selecting the active keymap (e.g. "keypad"). */
  readonly profileId?: string | null;
  /** Called when the `back` chain is exhausted (adapter wires this to router back). */
  readonly onNavigateBack?: () => void;
  /** When false the engine + global listener are detached (byte-for-byte baseline). */
  readonly enabled?: boolean;
  /** Always-reachable global commands (tab jump / diagnostics / device switcher / quick menu). */
  readonly shortcuts?: KeypadShortcutHandlers;
}

export const FocusNavigationProvider = ({
  children,
  profileId,
  onNavigateBack,
  enabled = true,
  shortcuts,
}: FocusNavigationProviderProps) => {
  const descriptorsRef = useRef(
    new Map<string, { descriptor: FocusDescriptor; resolveElement: () => HTMLElement | null }>(),
  );
  const onNavigateBackRef = useRef(onNavigateBack);
  onNavigateBackRef.current = onNavigateBack;
  const shortcutsRef = useRef<KeypadShortcutHandlers>(shortcuts ?? {});
  // Only swap when the prop actually changes — avoids allocating a fresh {} every
  // render when no shortcuts are passed (the common case in tests). Read sites use
  // fields, not object identity, so this is safe.
  if (shortcuts && shortcutsRef.current !== shortcuts) shortcutsRef.current = shortcuts;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // The element currently carrying `data-key-selected`, tracked imperatively so
  // the highlight toggle never goes through React state (avoids the known
  // setState-in-effect coverage hang).
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const scopeElementRef = useRef<HTMLElement | null>(null);
  const ringListenersRef = useRef(new Set<() => void>());
  const engineRef = useRef<FocusDiscoveryEngine | null>(null);
  const dispatchingRef = useRef(false);

  const openContextMenuFor = useCallback((element: HTMLElement | null, isGroup: boolean): boolean => {
    const trigger = findContextMenuTrigger(element, isGroup);
    trigger?.click();
    return trigger !== null;
  }, []);

  const ringElementFor = useCallback((id: string) => engineRef.current?.elementForId(id) ?? null, []);

  const controller = useMemo(() => {
    const created: NavigationController = new NavigationController({
      callbacks: {
        onFocus: (item) => focusRingElement(ringElementFor(item.id)),
        // After activation, keep the ring element focused — BUT respect an
        // activation that intentionally moved focus into the item's own subtree
        // (the field-row pattern focuses its inner <input> for editing). Yanking
        // focus back to the row there would break OK-to-edit; the synchronous
        // `contains` check lets that focus stand while still re-anchoring a plain
        // button/control that did not move focus.
        onActivate: (item) => {
          // Anchored on the ring's item, which for a single-control card is the card: DOM focus
          // left on the control it clicked took the next OK from the ring, and a card header's
          // toggle then closed the card it had just opened instead of going into it.
          const element = ringElementFor(created.focus.current()?.id ?? item.id);
          if (element && element.contains(document.activeElement)) return;
          // Activating a bare text field is the explicit "go in" that starts
          // editing, so it is the one place the field does take real DOM focus.
          // `focusRingElement` deliberately withholds focus from editables on
          // arrival (that is what stops the ring being trapped), so focus it
          // here instead of going through it. A synthetic click would not:
          // `.click()` does not move focus the way a real pointer press does.
          if (element && isEditableTarget(element)) {
            element.focus({ preventScroll: true });
            element.scrollIntoView({ block: "nearest", inline: "nearest" });
            return;
          }
          focusRingElement(element);
        },
        onNavigateBack: () => onNavigateBackRef.current?.(),
        onOpenMenu: (item) => {
          const opened = item
            ? openContextMenuFor(ringElementFor(item.id), created.focus.hasEnabledChildren(item.id))
            : openContextMenuFor(null, false);
          if (opened) return true;
          // No context menu for this item: fall back to the global quick menu. Report
          // whether we actually handled the key (a quick-menu handler exists) so the
          // navigation controller consumes the open-menu key instead of letting it
          // fall through as `ignored` (the callback contract returns boolean).
          const quickMenu = shortcutsRef.current.openQuickMenu;
          quickMenu?.();
          return Boolean(quickMenu);
        },
      },
    });
    return created;
  }, [openContextMenuFor, ringElementFor]);

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

  // Focus moved by a component's effect lands before the ring has scanned the control it moved to.
  const focusAwaitingRingRef = useRef<HTMLElement | null>(null);
  const adoptFocusAwaitingRingRef = useRef<() => void>(() => undefined);
  const engine = useMemo(
    () =>
      new FocusDiscoveryEngine({
        controller: controller.focus,
        listExplicit: () => Array.from(descriptorsRef.current.values()),
        freezeDuringTransientLayer: () => controller.layerDepth > 0,
        onAfterAssemble: () => {
          adoptFocusAwaitingRingRef.current();
          notifyRing();
        },
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

  const keymap = useInputProfile(profileId);

  /*
   * HARD27-039: the engine observes the whole body, so with the flag on - the
   * default for this variant - a touch user scrolling a virtualised list paid
   * for a ring they never enter. `start()` is idempotent and scans
   * synchronously, so deferring it to the first key costs that key nothing.
   */
  const startEngine = useCallback(() => {
    if (enabledRef.current) engine.start();
  }, [engine]);

  // Re-apply the highlight + notify the guidance bar whenever modality flips.
  // Starting first means the guidance bar sees a populated ring on the flip.
  useEffect(
    () =>
      subscribeInputModality((modality) => {
        if (modality === "key-navigation") startEngine();
        notifyRing();
      }),
    [notifyRing, startEngine],
  );

  // Run the discovery engine only while the flag is on (Prime Directive), and
  // only from the point key navigation is in use. Modality outlives the
  // provider, so a remount mid-session starts it straight away.
  useEffect(() => {
    if (!enabled) return;
    if (getInputModality() === "key-navigation") engine.start();
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
    // The innermost item holding focus: a card or dialog surface is an item too, and it is
    // listed before the control inside it that actually has focus.
    let innermost: { id: string; element: HTMLElement } | null = null;
    for (const item of controller.focus.list()) {
      const element = engineRef.current?.elementForId(item.id);
      if (!element?.contains(active)) continue;
      if (!innermost || innermost.element.contains(element)) innermost = { id: item.id, element };
    }
    if (innermost) controller.focus.setCurrent(innermost.id);
    return innermost?.element === active;
  }, [controller]);
  adoptFocusAwaitingRingRef.current = () => {
    const awaiting = focusAwaitingRingRef.current;
    focusAwaitingRingRef.current = null;
    if (awaiting && awaiting === document.activeElement) adoptActiveElement();
  };

  // Android's Back key reaches Capacitor, not the WebView; this turns it into the keydown the
  // handler below already knows how to read. Installed whether or not keypad navigation is on,
  // because the listener replaces Android's own Back handling for the whole app.
  useEffect(() => installDeviceBackButton(() => onNavigateBackRef.current?.()), []);

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
    // Up/Down inside a dialog move DOM focus, not the ring, and a button's own focus style fades
    // after 160 ms. Moving the ring onto the same control keeps the steady highlight on it.
    const followDialogFocus = () => {
      setInputModality("key-navigation");
      adoptActiveElement();
      notifyRing();
    };
    // Back out of a field to the ring stop that owns it, rather than to nothing. A bare blur left
    // DOM focus on the body, which is where a keypad user has no row to carry on from; the field's
    // own row is what they came from and what Down should move on from.
    const leaveFieldToItsRingStop = (field: EventTarget | null) => {
      const ringElement = engineRef.current?.elementForId(controller.focus.current()?.id ?? "") ?? null;
      if (ringElement && ringElement !== field) focusRingElement(ringElement);
      else if (field instanceof HTMLElement) field.blur();
    };
    // OK in a single-line field on a page is Done: it leaves the field as Back does. This runs in
    // the bubble phase, so a field that commits on Enter has already done so.
    const handleFieldDone = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSingleLineField(event.target)) return;
      if ((event.target as Element).closest(`${OPEN_OVERLAY_ANCESTOR_SELECTOR},[${SKIP_ATTR}]`)) return;
      const { action } = normalizeKeyEvent(event, keymap);
      if (action !== "enter" && action !== "center" && action !== "activate") return;
      leaveFieldToItsRingStop(event.target);
      setInputModality("key-navigation");
      notifyRing();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      // The tour owns every key while it is up. Its listener is registered after this one, so
      // stopping propagation there cannot keep OK from also activating the ring's item here. The
      // guidance bar is still refreshed, which is how it learns to stay hidden during the tour.
      if (document.documentElement.hasAttribute(TOUR_ACTIVE_ATTRIBUTE)) {
        notifyRing();
        return;
      }
      const normalized = normalizeKeyEvent(event, keymap);
      // Android's hardware Back carries no key code, so it matches no keymap binding. With an
      // overlay open it means Escape, which the overlay closes on; otherwise it is the hardware
      // `back`: disengage, come out of the card, and once nothing is left, leave the route.
      const isDeviceBackButton = isDeviceBackKey(event);
      const deviceBackAction = isAnyOverlayOpen() ? "escape" : "back";
      const action = normalized.action ?? (isDeviceBackButton ? deviceBackAction : null);
      // Before any branch below reads the ring, so the first key navigates.
      if (action !== null) startEngine();
      // Destructive toasts persist until dismissed (ERROR_POLICY §4) and render in their own
      // portal, so the keypad ring never reaches them: on a keypad-only device (no Tab, no touch)
      // an error toast covered the screen with no key able to dismiss it. Reuse the toast's own
      // tap handler (dismiss + open Diagnostics), but let an open dialog win. The Pixel 4 hardware
      // Back key arrives as {key:"Escape",code:"",keyCode:0}, matching no declared "back" binding.
      if ((action === "back" || isDeviceBackButton) && !document.querySelector(OPEN_OVERLAY_ANCESTOR_SELECTOR)) {
        const toast = document.querySelector<HTMLElement>('[data-testid="app-toast"]');
        if (toast) {
          toast.click();
          event.preventDefault();
          return;
        }
      }
      // Up/Down in a single-line field on a page leave the field and move the ring on from the
      // field's own stop: the caret cannot move vertically, and left to the WebView, spatial
      // navigation moved DOM focus to an arbitrary control while the highlight stayed on the field.
      const leavesPageField =
        (action === "dpadUp" || action === "dpadDown") &&
        isSingleLineField(event.target) &&
        !(event.target as Element).closest(`${OPEN_OVERLAY_ANCESTOR_SELECTOR},[${SKIP_ATTR}]`);
      if (leavesPageField) {
        // A field the user tapped into is where the ring continues from, so it is adopted first.
        if (getInputModality() === "pointer") adoptActiveElement();
        (event.target as HTMLElement).blur();
      }
      // Never touch editable targets (the field + its T9 composer own them); and
      // never log them, so typed text is never captured by diagnostics.
      if (isEditableTarget(event.target) && !leavesPageField) {
        // Up/Down inside a SINGLE-LINE field move focus rather than being swallowed. The caret
        // cannot move vertically there, so the key would otherwise do nothing at all — and inside
        // an overlay that is a dead end, because the ring is inert there and Escape belongs to the
        // dialog. A keypad user who landed in the host field of the discovery dialog could reach
        // nothing else, including its own Connect button. Textareas, selects and contenteditable
        // keep their vertical keys, which do mean something in those.
        if ((action === "dpadUp" || action === "dpadDown") && isSingleLineField(event.target)) {
          const overlay = (event.target as Element).closest(OPEN_OVERLAY_ANCESTOR_SELECTOR);
          // Except where the overlay has opted out with `data-key-nav-skip`, which says it drives
          // its own keys. The search overlay does: its Up/Down move an aria-activedescendant while
          // focus STAYS in the field, so stepping DOM focus here would stop the user typing on the
          // first press (spec.md section 5.7).
          const ownsItsKeys = (event.target as Element).closest(`[${SKIP_ATTR}]`) !== null;
          if (!ownsItsKeys && overlay && stepFocusWithinOverlay(overlay, event.target, action === "dpadDown")) {
            followDialogFocus();
            event.preventDefault();
            return;
          }
        }
        // One exception: Back and Escape always have to be able to take DOM focus out of a
        // field. Without it, anything that focuses a text input — an autofocus, a Tab, the ring's
        // own activation — leaves a keypad-only user with no key that reaches the navigation
        // handler again.
        if (action !== "back" && action !== "escape") return;
        // Unless the field is inside an open dialog or sheet, where that overlay owns the key and
        // the reader means "close this". Consuming it there left the dialog open with nothing but
        // a blurred field to show for the press.
        if (isWithinOpenOverlay(event.target)) return;
        leaveFieldToItsRingStop(event.target);
        event.preventDefault();
        return;
      }
      // While focus is inside an open Radix overlay, that overlay owns the key. Up/Down inside
      // a plain dialog/alert-dialog are the exception: Radix's own focus trap there only
      // answers to Tab, which a keypad handset does not have, so without this a dialog whose
      // first focus lands on a non-tabbable wrapper (every plain Radix DialogContent) is a
      // dead end for a keypad-only reader — Escape/Back can close it, but nothing can reach
      // its buttons. Same overlay-tab-order walk the editable-field case above already uses.
      // Menus/listboxes/poppers are deliberately excluded: Radix already drives Up/Down inside
      // those itself (a Select's own option highlighting), and re-walking them here would
      // fight that with a second, DOM-focus-based cursor.
      if (action === "dpadUp" || action === "dpadDown") {
        const overlay = event.target instanceof Element ? event.target.closest(DIALOG_ANCESTOR_SELECTOR) : null;
        if (overlay) {
          const from = document.activeElement instanceof Element ? document.activeElement : (event.target as Element);
          if (stepFocusWithinOverlay(overlay, from, action === "dpadDown")) {
            followDialogFocus();
            event.preventDefault();
            return;
          }
          return;
        }
      }
      // OK arrives as Enter, and checkboxes and radios follow WAI-ARIA in ignoring Enter; a keypad
      // has no Space key. Click them instead, or no key can toggle one that holds DOM focus.
      if (
        (action === "enter" || action === "center" || action === "activate") &&
        event.target instanceof HTMLElement &&
        event.target.matches(ENTER_IGNORING_CONTROL_SELECTOR)
      ) {
        event.target.click();
        event.preventDefault();
        return;
      }
      // Radix focuses the dialog itself on open, and the ring shows it as a group whose OK opens
      // it. Nothing inside the dialog answers OK on the dialog itself, so OK goes in here.
      if (
        (action === "enter" || action === "center" || action === "activate") &&
        event.target instanceof Element &&
        event.target.matches(DIALOG_ANCESTOR_SELECTOR) &&
        stepFocusWithinOverlay(event.target, event.target, true)
      ) {
        followDialogFocus();
        event.preventDefault();
        return;
      }
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
      // Always-reachable global shortcuts. Text fields and open overlays are
      // already excluded above, so digits/✱/# here mean "command", not T9 entry.
      // Digits 1–N jump to a tab; ✱ opens Diagnostics; # opens the Device Switcher.
      const shortcuts = shortcutsRef.current;
      const shortcutDigit = digitForAction(action);
      if (shortcutDigit !== null && shortcutDigit >= 1 && shortcutDigit <= TAB_ROUTES.length && shortcuts.jumpToTab) {
        // The tab bar stays in the ring across routes, so a ring standing on it would stay there;
        // a jump lands on the page it opened instead.
        controller.focus.resetToDefault();
        shortcuts.jumpToTab(shortcutDigit - 1);
        setInputModality("key-navigation");
        notifyRing();
        event.preventDefault();
        return;
      }
      // `0` only enters. Leaving stays on Back, per the app's "OK goes in, Back
      // comes out" rule; a key that did both would be ambiguous the moment the
      // sheet has focus — and inside the sheet `0` is a joystick direction, which
      // the open-overlay exclusion above already keeps this handler away from.
      // 8 and 9: the two machine controls this user opens the app for. They sit in Home's Quick
      // Actions grid, which is where they read best and is not moving; these are a shorter way to
      // the same actions. 7 is search and 0 is Game Mode, so these were the digits going spare.
      // A held key repeats. The one-shot commands below must run once per press, or holding 8
      // toggles pause and resume for as long as the key is down.
      // Call activates, and a held Call key would otherwise click the selected control once per repeat.
      const isOneShotCommand =
        action === "digit8" ||
        action === "digit9" ||
        action === "digit0" ||
        action === "star" ||
        action === "hash" ||
        action === "activate";
      if (isOneShotCommand && event.repeat) {
        event.preventDefault();
        return;
      }
      if (action === "digit8" && shortcuts.machinePauseResume) {
        shortcuts.machinePauseResume();
        setInputModality("key-navigation");
        event.preventDefault();
        return;
      }
      if (action === "digit9" && shortcuts.machineReset) {
        shortcuts.machineReset();
        setInputModality("key-navigation");
        event.preventDefault();
        return;
      }
      if (action === "digit0" && shortcuts.openGameMode) {
        shortcuts.openGameMode();
        setInputModality("key-navigation");
        event.preventDefault();
        return;
      }
      if (action === "star" && shortcuts.openDiagnostics) {
        shortcuts.openDiagnostics();
        setInputModality("key-navigation");
        event.preventDefault();
        return;
      }
      if (action === "hash" && shortcuts.openDeviceSwitcher) {
        shortcuts.openDeviceSwitcher();
        setInputModality("key-navigation");
        event.preventDefault();
        return;
      }
      // F1/F3 are neutral semantic actions. They are intentionally only routed
      // here, after editable/overlay exclusion and before global navigation.
      // Repeats never turn into repeated one-shot app commands.
      if ((action === "function1" || action === "function3") && !event.repeat && shortcuts.runFunctionShortcut) {
        shortcuts.runFunctionShortcut(action === "function1" ? 1 : 3);
        setInputModality("key-navigation");
        event.preventDefault();
        return;
      }
      if ((action === "function1" || action === "function3") && event.repeat) {
        event.preventDefault();
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

      // Focus the ring moves itself during a dispatch is already where the ring wants it; adopting
      // it again would, for one, descend into a card whose single control OK just activated.
      dispatchingRef.current = true;
      let handled = false;
      try {
        handled = controller.dispatch(action).type !== "ignored";
      } finally {
        dispatchingRef.current = false;
      }
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
    // Focus the app moves by itself is where the user is: menus and listboxes move it on Up/Down,
    // and a closing menu hands it back to its trigger. The highlight follows it, or OK would act on
    // the focused control while the highlight showed another. A menu also focuses its first item on
    // open without scrolling to it, so inside an overlay the item is brought into view: on a short
    // screen a tall menu opened with the focused item below the fold.
    const handleFocusIn = (event: FocusEvent) => {
      if (dispatchingRef.current) return;
      if (getInputModality() !== "key-navigation" || !(event.target instanceof HTMLElement)) return;
      focusAwaitingRingRef.current = adoptActiveElement() ? null : event.target;
      notifyRing();
      if (isWithinOpenOverlay(event.target)) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keydown", handleFieldDone);
    window.addEventListener("pointerdown", handlePointer, true);
    window.addEventListener("touchstart", handlePointer, true);
    window.addEventListener("focusin", handleFocusIn, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keydown", handleFieldDone);
      window.removeEventListener("pointerdown", handlePointer, true);
      window.removeEventListener("touchstart", handlePointer, true);
      window.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [adoptActiveElement, controller, enabled, keymap, notifyRing, startEngine]);

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

  return useDescriptorRegistration(descriptor, elementRef);
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
  return useDescriptorRegistration(descriptor, elementRef);
}

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Context guidance bar — the keypad-first device's soft-key + breadcrumb strip
 * (CONFIRMED DECISION 3). A fixed overlay (no page reflow) that names the current
 * scope and labels the Back / OK / Menu keys for whatever the ring is on.
 *
 * Visibility is the SAME gate as the highlight: it shows only when the keypad
 * flag is on AND modality is `key-navigation`, and disappears the instant a
 * pointer/touch flips modality. It adds zero pointer/touch regression
 * (`pointer-events: none`, hidden in pointer modality).
 *
 * IMPLEMENTATION: the skeleton is rendered once (declarative, styled) and never
 * re-renders; its text + visibility are updated IMPERATIVELY from the provider's
 * ring-change subscription — exactly mirroring `refreshHighlight`. There is NO
 * React state here, so there is no setState-in-effect re-render loop (the
 * project's known coverage hang) and no `act()` churn from the engine's async
 * re-scans. All label text comes from the PURE {@link resolveGuidanceLabels};
 * this component only assembles the DOM-free snapshot and writes the result.
 */

import { useCallback, useEffect, useRef } from "react";

import { useFocusNavigationContext, type FocusNavigationContextValue } from "@/hooks/useFocusNavigation";
import {
  accessibleLabelFor,
  classifyFocusKind,
  getInputModality,
  hasContextMenu,
  resolveGuidanceLabels,
  type GuidanceState,
} from "@/lib/input";

/** Assemble the DOM-free {@link GuidanceState} the pure resolver consumes. */
const buildGuidanceState = (context: FocusNavigationContextValue): GuidanceState => {
  const { controller, engine, enabled } = context;
  const focus = controller.focus;
  const current = focus.current();
  const currentElement = current ? engine.elementForId(current.id) : null;
  const isGroup = focus.currentHasEnabledChildren();

  // Breadcrumb: the ancestor group labels we are inside, then the current item.
  const breadcrumb = engine.currentScopeChain().map((item) => item.group ?? item.id);
  const currentLabel = isGroup
    ? (current?.group ?? accessibleLabelFor(currentElement))
    : accessibleLabelFor(currentElement);
  if (currentLabel) breadcrumb.push(currentLabel);

  return {
    enabled,
    modality: getInputModality(),
    hasCurrent: current !== null,
    currentKind: classifyFocusKind(currentElement, isGroup),
    breadcrumb,
    atRoot: focus.currentScopeParentId() === null,
    fieldEngaged: controller.isFieldEngaged,
    layerOpen: controller.layerDepth > 0,
    hasMenu: hasContextMenu(currentElement),
  };
};

/**
 * Imperative writes with a VALUE-EQUALITY BAIL — only touch the DOM when the value
 * actually changed. This is load-bearing, not just an optimisation: the engine's
 * MutationObserver watches the whole body subtree, and a redundant write here
 * (text-node replacement, attribute toggle) would queue a mutation → re-scan →
 * `onAfterAssemble` → notifyRing → another write … i.e. an infinite refresh loop
 * (the project's CPU-pegged coverage hang). Writing only on real change makes the
 * cycle converge after one settle.
 */
const setTextIfChanged = (element: HTMLElement | null, text: string): void => {
  if (element && element.textContent !== text) element.textContent = text;
};
const setAttrIfChanged = (element: HTMLElement | null, name: string, value: string): void => {
  if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
};

/** Show/hide a soft-key slot and set its action text, each guarded by a value bail. */
const applySlot = (slot: HTMLElement | null, action: HTMLElement | null, label: string | null): void => {
  if (!slot || !action) return;
  if (label) {
    setTextIfChanged(action, label);
    if (slot.hasAttribute("hidden")) slot.removeAttribute("hidden");
  } else if (!slot.hasAttribute("hidden")) {
    slot.setAttribute("hidden", "");
  }
};

export const KeypadGuidanceBar = () => {
  const context = useFocusNavigationContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const leftActionRef = useRef<HTMLSpanElement>(null);
  const centerSlotRef = useRef<HTMLSpanElement>(null);
  const centerActionRef = useRef<HTMLSpanElement>(null);
  const rightSlotRef = useRef<HTMLSpanElement>(null);
  const rightActionRef = useRef<HTMLSpanElement>(null);

  const refresh = useCallback(() => {
    const root = rootRef.current;
    if (!root || !context) return;
    const labels = resolveGuidanceLabels(buildGuidanceState(context));
    if (!labels.visible) {
      setAttrIfChanged(root, "data-visible", "false");
      return;
    }
    setAttrIfChanged(root, "data-visible", "true");
    // One joined text node (not per-segment elements): the bar is aria-hidden
    // chrome that mirrors on-screen text, so a single string keeps it out of
    // role/text queries for the real controls behind it.
    setTextIfChanged(
      breadcrumbRef.current,
      labels.breadcrumb.length > 0 ? labels.breadcrumb.join("  ›  ") : "Navigation",
    );
    setTextIfChanged(leftActionRef.current, labels.left);
    applySlot(centerSlotRef.current, centerActionRef.current, labels.center);
    applySlot(rightSlotRef.current, rightActionRef.current, labels.right);
  }, [context]);

  // Subscribe imperatively (mirrors refreshHighlight). The provider's notifyRing
  // fans out here on assembly, on each handled key, and on a modality flip, so
  // one subscription covers visibility + content. No React state → no re-render.
  useEffect(() => {
    if (!context) return;
    refresh();
    return context.subscribeRingChange(refresh);
  }, [context, refresh]);

  if (!context) return null;

  return (
    // aria-hidden: the focused element already conveys position/role to assistive
    // tech (it carries real DOM focus), so the bar is redundant chrome for AT and
    // must not spam a live region.
    <div
      ref={rootRef}
      className="keypad-guidance-bar"
      data-visible="false"
      data-testid="keypad-guidance-bar"
      aria-hidden="true"
    >
      <div ref={breadcrumbRef} className="keypad-guidance-breadcrumb" data-testid="keypad-guidance-breadcrumb" />
      <div className="keypad-guidance-keys">
        <span className="keypad-guidance-key" data-soft="left" data-testid="keypad-guidance-left">
          <kbd className="keypad-guidance-cap">Back</kbd>
          <span ref={leftActionRef} className="keypad-guidance-action" />
        </span>
        <span
          ref={centerSlotRef}
          className="keypad-guidance-key"
          data-soft="center"
          data-testid="keypad-guidance-center"
        >
          <kbd className="keypad-guidance-cap">OK</kbd>
          <span ref={centerActionRef} className="keypad-guidance-action" />
        </span>
        <span
          ref={rightSlotRef}
          className="keypad-guidance-key"
          data-soft="right"
          data-testid="keypad-guidance-right"
          hidden
        >
          <kbd className="keypad-guidance-cap">Menu</kbd>
          <span ref={rightActionRef} className="keypad-guidance-action" />
        </span>
      </div>
    </div>
  );
};

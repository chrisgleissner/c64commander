/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type InteractiveElement = HTMLElement & {
  __c64TapFlashTimeoutId?: number;
  __c64PointerFocusClearPending?: boolean;
};

export const CTA_HIGHLIGHT_ATTR = "data-c64-tap-flash";
export const CTA_HIGHLIGHT_SET_AT_ATTR = "data-c64-tap-flash-set-at";
export const CTA_HIGHLIGHT_DURATION_MS = 150;
/**
 * The floor an end-to-end test may assert the flash lasted.
 *
 * There is deliberately no matching ceiling. A browser can only make the flash
 * outlast its timer, never undercut it, so a floor is a property of the app while
 * a ceiling is a property of whatever machine the test happens to run on. That the
 * flash ends after `CTA_HIGHLIGHT_DURATION_MS` is asserted with fake timers in the
 * unit tests instead.
 */
export const CTA_HIGHLIGHT_MIN_EXPECTED_MS = 120;
export const CTA_HIGHLIGHT_MAX_AGE_MS = 2000;
export const CTA_PERSISTENT_ACTIVE_ATTR = "data-c64-persistent-active";
export const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[data-c64-interactive="true"]',
].join(",");

const hasDisabledState = (element: HTMLElement) => {
  if (element.matches(":disabled")) return true;
  if (element.hasAttribute("disabled")) return true;
  if (element.getAttribute("aria-disabled") === "true") return true;
  if (element.hasAttribute("data-disabled")) return true;
  if (element.closest('[aria-disabled="true"]')) return true;
  return false;
};

const clearTapFlash = (element: InteractiveElement) => {
  if (typeof element.__c64TapFlashTimeoutId === "number") {
    window.clearTimeout(element.__c64TapFlashTimeoutId);
  }
  delete element.__c64TapFlashTimeoutId;
  element.removeAttribute(CTA_HIGHLIGHT_ATTR);
  element.removeAttribute(CTA_HIGHLIGHT_SET_AT_ATTR);
};

const clearPendingPointerFocus = (element: InteractiveElement) => {
  delete element.__c64PointerFocusClearPending;
};

const attemptPendingPointerFocusClear = (element: InteractiveElement) => {
  if (!element.__c64PointerFocusClearPending) return;
  if (!element.isConnected) {
    clearPendingPointerFocus(element);
    return;
  }
  if (document.activeElement !== element) {
    clearPendingPointerFocus(element);
    return;
  }
  if (typeof element.blur !== "function") {
    clearPendingPointerFocus(element);
    return;
  }
  element.blur();
  if (document.activeElement !== element) {
    clearPendingPointerFocus(element);
  }
};

const setTapFlash = (element: InteractiveElement) => {
  clearTapFlash(element);
  element.setAttribute(CTA_HIGHLIGHT_ATTR, "true");
  element.setAttribute(CTA_HIGHLIGHT_SET_AT_ATTR, String(Date.now()));
  element.__c64TapFlashTimeoutId = window.setTimeout(() => {
    clearTapFlash(element);
  }, CTA_HIGHLIGHT_DURATION_MS);
};

const clearPointerFocus = (element: HTMLElement) => {
  const interactive = element as InteractiveElement;
  interactive.__c64PointerFocusClearPending = true;
  window.setTimeout(() => {
    attemptPendingPointerFocusClear(interactive);
  }, 0);
};

const shouldSkipStatelessInteraction = (element: HTMLElement) =>
  element.getAttribute(CTA_PERSISTENT_ACTIVE_ATTR) === "true";

const resolveInteractiveElement = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  if (!(interactive instanceof HTMLElement)) return null;
  return interactive;
};

export const applyPointerButtonInteraction = (element: HTMLElement) => {
  clearPointerFocus(element);
  if (hasDisabledState(element)) return;
  if (shouldSkipStatelessInteraction(element)) return;
  setTapFlash(element);
};

export const handlePointerButtonClick = (event: { detail: number; currentTarget: EventTarget | null }) => {
  if (event.detail === 0) return;
  const target =
    resolveInteractiveElement(event.currentTarget) ??
    (event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  if (!target) return;
  // Skip when the global pointerup handler already applied the flash for this interaction
  // (pointerup fires before click, so the attribute is already set if global handler ran).
  if (target.hasAttribute(CTA_HIGHLIGHT_ATTR)) return;
  applyPointerButtonInteraction(target);
};

/** How long, and how far from the lifted finger, a touch's compatibility click may still arrive. */
export const GHOST_CLICK_WINDOW_MS = 800;
export const GHOST_CLICK_SLOP_PX = 24;

/**
 * A touch browser sends compatibility `mousedown` and `click` ~100 ms after `pointerup`, to whatever is
 * under the finger by then. A control that acts on `pointerup` and opens a dialog there had them press
 * the dialog's button (Add items chose "C64U" unasked) or focus its field. Swallow both events of this
 * tap when they land outside `origin`; the origin's own click is left to the origin.
 */
export const swallowGhostClickAfterTouch = (
  origin: HTMLElement,
  point: { x: number; y: number },
  onSwallowed: () => void,
) => {
  const doc = origin.ownerDocument;
  const isGhost = (event: MouseEvent) =>
    !(event.target instanceof Node && origin.contains(event.target)) &&
    Math.abs(event.clientX - point.x) <= GHOST_CLICK_SLOP_PX &&
    Math.abs(event.clientY - point.y) <= GHOST_CLICK_SLOP_PX;
  const disarm = () => {
    doc.removeEventListener("mousedown", onMouseDown, true);
    doc.removeEventListener("click", onClick, true);
    window.clearTimeout(timer);
  };
  const onMouseDown = (event: MouseEvent) => {
    // Cancelling the default action is what keeps a field under the finger from taking focus.
    if (isGhost(event)) event.preventDefault();
  };
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0) return;
    disarm();
    if (!isGhost(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onSwallowed();
  };
  doc.addEventListener("mousedown", onMouseDown, true);
  doc.addEventListener("click", onClick, true);
  const timer = window.setTimeout(disarm, GHOST_CLICK_WINDOW_MS);
};

export const sweepStaleHighlights = (nowMs = Date.now()) => {
  const highlighted = document.querySelectorAll<HTMLElement>(`[${CTA_HIGHLIGHT_ATTR}]`);
  highlighted.forEach((el) => {
    const setAt = Number(el.getAttribute(CTA_HIGHLIGHT_SET_AT_ATTR) ?? "0");
    if (nowMs - setAt >= CTA_HIGHLIGHT_MAX_AGE_MS) {
      clearTapFlash(el);
    }
  });
};

export const registerGlobalButtonInteractionModel = () => {
  const pointerUpHandler = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const interactive = resolveInteractiveElement(event.target);
    if (!interactive) return;
    applyPointerButtonInteraction(interactive);
  };

  const clearPendingActiveFocus = () => {
    sweepStaleHighlights();
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active === document.body) return;
    const interactive = resolveInteractiveElement(active);
    if (!interactive) return;
    attemptPendingPointerFocusClear(interactive);
  };

  // When the app regains focus or visibility after a native picker / overlay,
  // retry the pointer-originated blur so focus-visible styling cannot stick.
  const visibilityChangeHandler = () => {
    if (document.visibilityState !== "visible") return;
    clearPendingActiveFocus();
  };

  const resumeHandler = () => clearPendingActiveFocus();

  document.addEventListener("pointerup", pointerUpHandler, true);
  document.addEventListener("visibilitychange", visibilityChangeHandler);
  window.addEventListener("focus", resumeHandler);
  window.addEventListener("pageshow", resumeHandler);
  return () => {
    document.removeEventListener("pointerup", pointerUpHandler, true);
    document.removeEventListener("visibilitychange", visibilityChangeHandler);
    window.removeEventListener("focus", resumeHandler);
    window.removeEventListener("pageshow", resumeHandler);
  };
};

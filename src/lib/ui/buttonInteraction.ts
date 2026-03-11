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
export const CTA_HIGHLIGHT_MIN_EXPECTED_MS = 120;
export const CTA_HIGHLIGHT_MAX_EXPECTED_MS = 200;
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
  setTapFlash(element as InteractiveElement);
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

export const sweepStaleHighlights = (nowMs = Date.now()) => {
  const highlighted = document.querySelectorAll<HTMLElement>(`[${CTA_HIGHLIGHT_ATTR}]`);
  highlighted.forEach((el) => {
    const setAt = Number(el.getAttribute(CTA_HIGHLIGHT_SET_AT_ATTR) ?? "0");
    if (nowMs - setAt >= CTA_HIGHLIGHT_MAX_AGE_MS) {
      clearTapFlash(el as InteractiveElement);
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
    attemptPendingPointerFocusClear(interactive as InteractiveElement);
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

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type InteractiveElement = HTMLElement & {
  __c64TapFlashTimeoutId?: number;
};

export const CTA_HIGHLIGHT_ATTR = 'data-c64-tap-flash';
export const CTA_HIGHLIGHT_DURATION_MS = 220;
const CTA_PERSISTENT_ACTIVE_ATTR = 'data-c64-persistent-active';
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'summary',
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
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const clearTapFlash = (element: InteractiveElement) => {
  if (typeof element.__c64TapFlashTimeoutId === 'number') {
    window.clearTimeout(element.__c64TapFlashTimeoutId);
  }
  delete element.__c64TapFlashTimeoutId;
  element.removeAttribute(CTA_HIGHLIGHT_ATTR);
};

const setTapFlash = (element: InteractiveElement) => {
  clearTapFlash(element);
  element.setAttribute(CTA_HIGHLIGHT_ATTR, 'true');
  element.__c64TapFlashTimeoutId = window.setTimeout(() => {
    clearTapFlash(element);
  }, CTA_HIGHLIGHT_DURATION_MS);
};

const clearPointerFocus = (element: HTMLElement) => {
  if (document.activeElement !== element || typeof element.blur !== 'function') return;
  window.setTimeout(() => element.blur(), 0);
};

const shouldSkipStatelessInteraction = (element: HTMLElement) =>
  element.getAttribute(CTA_PERSISTENT_ACTIVE_ATTR) === 'true';

const resolveInteractiveElement = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  if (!(interactive instanceof HTMLElement)) return null;
  return interactive;
};

export const applyPointerButtonInteraction = (element: HTMLElement) => {
  clearPointerFocus(element);
  if (shouldSkipStatelessInteraction(element)) return;
  setTapFlash(element as InteractiveElement);
};

export const handlePointerButtonClick = (event: { detail: number; currentTarget: EventTarget | null }) => {
  if (event.detail === 0) return;
  const target = resolveInteractiveElement(event.currentTarget)
    ?? (event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  if (!target) return;
  applyPointerButtonInteraction(target);
};

export const registerGlobalButtonInteractionModel = () => {
  const handler = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const interactive = resolveInteractiveElement(event.target);
    if (!interactive) return;
    applyPointerButtonInteraction(interactive);
  };

  document.addEventListener('pointerup', handler, true);
  return () => {
    document.removeEventListener('pointerup', handler, true);
  };
};

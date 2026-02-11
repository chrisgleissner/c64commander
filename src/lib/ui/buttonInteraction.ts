/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type InteractiveElement = HTMLElement & {
  __c64TapFlashTimeoutId?: number;
};

const TAP_FLASH_ATTR = 'data-c64-tap-flash';
const TAP_FLASH_DURATION_MS = 200;
const BUTTON_SELECTOR = 'button,[role="button"],input[type="button"],input[type="submit"]';

const clearTapFlash = (element: InteractiveElement) => {
  if (typeof element.__c64TapFlashTimeoutId === 'number') {
    window.clearTimeout(element.__c64TapFlashTimeoutId);
  }
  delete element.__c64TapFlashTimeoutId;
  element.removeAttribute(TAP_FLASH_ATTR);
};

const setTapFlash = (element: InteractiveElement) => {
  clearTapFlash(element);
  element.setAttribute(TAP_FLASH_ATTR, 'true');
  element.__c64TapFlashTimeoutId = window.setTimeout(() => {
    clearTapFlash(element);
  }, TAP_FLASH_DURATION_MS);
};

const clearPointerFocus = (element: HTMLElement) => {
  if (document.activeElement !== element || typeof element.blur !== 'function') return;
  window.setTimeout(() => element.blur(), 0);
};

const shouldSkipStatelessInteraction = (element: HTMLElement) => {
  const mode = element.getAttribute('data-button-mode');
  if (mode && mode.toLowerCase() === 'toggle') return true;
  return false;
};

export const applyPointerButtonInteraction = (element: HTMLElement) => {
  clearPointerFocus(element);
  if (shouldSkipStatelessInteraction(element)) return;
  setTapFlash(element as InteractiveElement);
};

export const handlePointerButtonClick = (event: { detail: number; currentTarget: EventTarget | null }) => {
  if (event.detail === 0) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  applyPointerButtonInteraction(target);
};

export const registerGlobalButtonInteractionModel = () => {
  const handler = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest(BUTTON_SELECTOR);
    if (!(button instanceof HTMLElement)) return;
    applyPointerButtonInteraction(button);
  };

  document.addEventListener('pointerup', handler, true);
  return () => {
    document.removeEventListener('pointerup', handler, true);
  };
};

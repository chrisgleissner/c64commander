/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** DOM moves the keypad ring makes: focusing its item, and walking focus inside an overlay. */

import { INTERACTIVE_SELECTOR, isFocusDisabled, isFocusVisible } from "@/lib/input/discovery";
import { isEditableTarget, OPEN_OVERLAY_ANCESTOR_SELECTOR } from "@/lib/input/eventTargets";
import { resolveRingScrollAlignment } from "@/lib/input/ringScroll";

/**
 * The subset of `OPEN_OVERLAY_ANCESTOR_SELECTOR` that has no native Up/Down of its own.
 * A menu/listbox/popper (a Select's dropdown, a context menu) already drives Up/Down itself —
 * Radix moves its own highlighted option — so walking the DOM tab order there too would add a
 * second, DOM-focus-based cursor fighting the first. A plain dialog/alert-dialog has no such
 * built-in cursor; Radix gives it only a Tab focus trap, which a keypad handset cannot use.
 */
export const DIALOG_ANCESTOR_SELECTOR = '[role="dialog"],[role="alertdialog"]';
/** Controls that ignore Enter by design and toggle only on Space or a click. */
export const ENTER_IGNORING_CONTROL_SELECTOR = '[role="checkbox"],[role="radio"]';

/**
 * Move focus to the next/previous tabbable inside `overlay`, wrapping at the ends.
 *
 * The global ring is deliberately inert inside a Radix overlay — that overlay owns the
 * keyboard (HAZARD 2) — so a keypad has nothing to move focus with in there except Tab,
 * which a keypad handset does not have. Inside a dialog, Escape is the overlay's own and
 * closes it, so a text field with focus becomes a dead end: no key reaches anything else.
 * This walks the overlay's own tab order instead of touching the ring.
 */
export const stepFocusWithinOverlay = (overlay: Element, from: Element, forward: boolean): boolean => {
  const tabbables = [...overlay.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)].filter(
    (element) => isFocusVisible(element) && !isFocusDisabled(element),
  );
  if (tabbables.length === 0) return false;
  const index = tabbables.indexOf(from as HTMLElement);
  // `from` is not itself tabbable right after a Radix dialog opens — it autofocuses its
  // content wrapper (tabIndex -1), not a real control. Land on the first/last tabbable
  // instead of failing, so the very first press already reaches something.
  const next =
    index === -1
      ? tabbables[forward ? 0 : tabbables.length - 1]
      : tabbables[(index + (forward ? 1 : -1) + tabbables.length) % tabbables.length];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
  return true;
};

export const isWithinOpenOverlay = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(OPEN_OVERLAY_ANCESTOR_SELECTOR) !== null;

/**
 * True for elements the browser activates natively on Enter/Space. When such an
 * element holds DOM focus via Tab / programmatic focus / assistive tech (i.e. not
 * through the ring, which would also `element.focus()` its current item), the
 * browser owns activation — the global ring must not fire its own current item.
 */
export const isNativelyActivatable = (element: Element): boolean => {
  const tag = element.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY") return true;
  if (tag === "A") return element.hasAttribute("href");
  return false;
};

/** Carries the keypad scroll-margins; moved between focused elements (never inline). */
const KEYPAD_SCROLL_ANCHOR_CLASS = "keypad-scroll-anchor";
let keypadScrollAnchorEl: HTMLElement | null = null;

/**
 * True when the ring may hand real DOM focus to this element.
 *
 * A text field is the one thing the ring must not focus on arrival. Focusing it
 * makes every later key an editable target, and `isEditableTarget` then returns
 * from the global handler before any ring navigation runs — so the ring can never
 * move off the field again. On a keypad-only device with the touchscreen off that
 * is unescapable. Fields wrapped in a field-row already avoid this by making the
 * row the ring item and focusing the inner <input> only on an explicit activation;
 * this makes a bare, unwrapped field behave the same way. The field still receives
 * the selection highlight, and Enter still focuses it for editing.
 */
const acceptsRingFocus = (element: HTMLElement): boolean => !isEditableTarget(element);

export const focusRingElement = (element: HTMLElement | null): void => {
  if (!element) return;
  // Keep the focused control fully visible: reserve space for the fixed header
  // (top) and the guidance bar + tab bar (bottom) so `scrollIntoView` never parks
  // the control beneath the app chrome. The scroll-margins live in a single CSS
  // class moved from the previously-anchored element to this one — no per-element
  // inline styles to leak or lock in. `preventScroll` on focus lets the
  // margin-aware `scrollIntoView` own the scroll instead of the browser's default
  // focus scroll (which ignores scroll-margin).
  if (keypadScrollAnchorEl && keypadScrollAnchorEl !== element) {
    keypadScrollAnchorEl.classList.remove(KEYPAD_SCROLL_ANCHOR_CLASS);
  }
  element.classList.add(KEYPAD_SCROLL_ANCHOR_CLASS);
  keypadScrollAnchorEl = element;
  if (acceptsRingFocus(element)) {
    element.focus({ preventScroll: true });
  } else if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    // The ring is not taking DOM focus, so whatever held it before must give it
    // up. Two things go wrong otherwise. If the previous element was a field, its
    // editable target keeps swallowing the navigation keys. If it was a button or
    // link, `isNativelyActivatable` sees a focused control the browser would
    // activate itself, the ring stands down on Enter, and the key reaches the
    // element the ring left rather than the one it is on.
    document.activeElement.blur();
  }
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const block = resolveRingScrollAlignment({
    top: rect.top,
    bottom: rect.bottom,
    height: rect.height,
    viewportHeight: window.innerHeight,
    marginTop: parseFloat(style.scrollMarginTop) || 0,
    marginBottom: parseFloat(style.scrollMarginBottom) || 0,
  });
  element.scrollIntoView({ block, inline: "nearest" });
};

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** DOM moves the keypad ring makes: focusing its item, and walking focus inside an overlay. */

import { keepPlatformInputMethodAway } from "@/lib/input/hardwareKeypadInputMethod";
import { INTERACTIVE_SELECTOR, isFocusDisabled, isFocusVisible } from "@/lib/input/discovery";
import { isEditableTarget, OPEN_OVERLAY_ANCESTOR_SELECTOR } from "@/lib/input/eventTargets";
import type { FocusController } from "@/lib/input/focusController";
import { resolveRingScrollAlignment } from "@/lib/input/ringScroll";
import { getInputModality } from "@/lib/input/inputModality";
import { KEYPAD_GUIDANCE_RESERVE_EVENT } from "@/lib/ui/keypadGuidanceReserve";

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
 * A field row in an overlay: the keypad stops on the row, and OK hands focus to its input. Focusing
 * the input on arrival opened the system keyboard for a numeric field and halved the screen.
 */
export const FIELD_FRAME_ATTR = "data-field-frame";
const FIELD_FRAME_SELECTOR = `[${FIELD_FRAME_ATTR}]`;

/** The input a field frame edits, or null when the element is not a field frame. */
export const fieldOfFrame = (element: Element | null): HTMLElement | null =>
  element instanceof HTMLElement && element.matches(FIELD_FRAME_SELECTOR)
    ? element.querySelector<HTMLElement>("input,textarea")
    : null;

/** The field frame whose input this is, or null for anything else. */
export const frameOfField = (element: Element | null): HTMLElement | null =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.closest<HTMLElement>(FIELD_FRAME_SELECTOR)
    : null;

export const isActivation = (action: string | null): boolean =>
  action === "enter" || action === "center" || action === "activate";

/** OK on a field row in a dialog edits its input; OK in that input returns to the row. */
export const toggleFieldFrameEditing = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element) || target.closest(OPEN_OVERLAY_ANCESTOR_SELECTOR) === null) return false;
  const next = fieldOfFrame(target) ?? frameOfField(target);
  next?.focus();
  return next !== null;
};

const overlayStops = (overlay: Element): HTMLElement[] =>
  [...overlay.querySelectorAll<HTMLElement>(`${INTERACTIVE_SELECTOR},${FIELD_FRAME_SELECTOR}`)].filter(
    (element) => isFocusVisible(element) && !isFocusDisabled(element) && frameOfField(element) === null,
  );

/**
 * Move focus to the next/previous tabbable inside `overlay`, wrapping at the ends.
 *
 * The global ring is deliberately inert inside a Radix overlay — that overlay owns the
 * keyboard (HAZARD 2) — so a keypad has nothing to move focus with in there except Tab,
 * which a keypad handset does not have. Inside a dialog, Escape is the overlay's own and
 * closes it, so a text field with focus becomes a dead end: no key reaches anything else.
 * This walks the overlay's own tab order instead of touching the ring.
 */
export const stepFocusWithinOverlay = (overlay: Element, fromElement: Element, forward: boolean): boolean => {
  const tabbables = overlayStops(overlay);
  if (tabbables.length === 0) return false;
  const from = frameOfField(fromElement) ?? fromElement;
  const index = tabbables.indexOf(from as HTMLElement);
  // `from` is not itself tabbable right after a Radix dialog opens — it autofocuses its
  // content wrapper (tabIndex -1), not a real control. Land on the first/last tabbable
  // instead of failing, so the very first press already reaches something.
  const next =
    index === -1
      ? tabbables[forward ? 0 : tabbables.length - 1]
      : tabbables[(index + (forward ? 1 : -1) + tabbables.length) % tabbables.length];
  if (index !== -1) {
    if (scrollThroughTallStop(overlay, from, forward ? 1 : -1)) return true;
    // Wrapping, or moving on to a footer button outside the scrolling body, would leave the
    // body's remaining text unreachable, so the body scrolls toward it first.
    const wraps = index === (forward ? tabbables.length - 1 : 0);
    const leavesBody = leavesScrollContainer(from, next);
    if ((wraps || leavesBody) && scrollOverlayTowardUnreachableContent(overlay, from, forward ? 1 : -1)) return true;
  }
  keepPlatformInputMethodAway(next);
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
  scrollRingElementIntoView(element);
};

/** Scrolls the element into the part of its scroll container the app chrome leaves free; it moves no focus. */
const scrollRingElementIntoView = (element: HTMLElement): void => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const scrollport = visibleBoundsOf(scrollContainerOf(element));
  const block = resolveRingScrollAlignment({
    top: rect.top,
    bottom: rect.bottom,
    height: rect.height,
    scrollportTop: scrollport.top,
    scrollportBottom: scrollport.bottom,
    marginTop: parseFloat(style.scrollMarginTop) || 0,
    marginBottom: parseFloat(style.scrollMarginBottom) || 0,
  });
  element.scrollIntoView({ block, inline: "nearest" });
};

const REVEAL_WINDOW_MS = 1500;
const REVEAL_CHECK_DELAYS_MS = [120, 400, 800, REVEAL_WINDOW_MS];

/** True when the element's box lies wholly above or below the part of its scroll container that is on screen. */
export const isOutsideScrollport = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect();
  const scrollport = visibleBoundsOf(scrollContainerOf(element));
  return rect.bottom <= scrollport.top || rect.top >= scrollport.bottom;
};

/** True when the element is out of sight, or its end is under the bars while it would fit above them. */
const needsReveal = (element: HTMLElement): boolean => {
  if (isOutsideScrollport(element)) return true;
  const rect = element.getBoundingClientRect();
  const scrollport = visibleBoundsOf(scrollContainerOf(element));
  const style = getComputedStyle(element);
  const areaTop = scrollport.top + (parseFloat(style.scrollMarginTop) || 0);
  const areaBottom = scrollport.bottom - (parseFloat(style.scrollMarginBottom) || 0);
  return rect.height <= areaBottom - areaTop && (rect.top < areaTop - 1 || rect.bottom > areaBottom + 1);
};

/**
 * Bring the ring's element back into view when activating it changed the layout around it, such as a
 * larger text size, which moved the control the keypad user had just pressed off the screen.
 *
 * The layout can keep changing after the press, and the pressed element can be replaced, so for a
 * short while every size or structure change in its scroll container re-checks whichever element
 * the ring is on. Any key or pointer input ends the watch: the user has moved on.
 */
export const revealRingElementAfterLayout = (element: HTMLElement | null): (() => void) => {
  if (!element) return () => {};
  const revealCurrent = () => {
    const current = keypadScrollAnchorEl;
    if (current?.isConnected && needsReveal(current)) focusRingElement(current);
  };
  const container = scrollContainerOf(element);
  const watched = container === document.scrollingElement ? document.body : container;
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(revealCurrent);
  resizeObserver?.observe(watched);
  Array.from(watched.children).forEach((child) => resizeObserver?.observe(child));
  const mutationObserver = new MutationObserver(revealCurrent);
  mutationObserver.observe(watched, { childList: true, subtree: true, characterData: true });
  const timers = REVEAL_CHECK_DELAYS_MS.map((delay) => window.setTimeout(revealCurrent, delay));
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    timers.forEach((timer) => window.clearTimeout(timer));
    window.clearTimeout(endTimer);
    resizeObserver?.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener("keydown", cancel, true);
    window.removeEventListener("pointerdown", cancel, true);
  };
  const endTimer = window.setTimeout(cancel, REVEAL_WINDOW_MS + 1);
  window.addEventListener("keydown", cancel, true);
  window.addEventListener("pointerdown", cancel, true);
  return cancel;
};

/** A text field has focus and is not part of the ring's element, so a scroll would pull the page from under it. */
const isEditedOutside = (ring: HTMLElement): boolean =>
  isEditableTarget(document.activeElement) && !ring.contains(document.activeElement);

/** An overlay that is closing keeps its markup for the exit animation, and no longer counts. */
const hasOpenOverlay = (): boolean =>
  Array.from(document.querySelectorAll(OPEN_OVERLAY_ANCESTOR_SELECTOR)).some((overlay) => {
    const state =
      overlay.getAttribute("data-state") ?? overlay.querySelector(":scope > [data-state]")?.getAttribute("data-state");
    return state !== "closed";
  });

/**
 * Keeps the ring's element on screen when the space the page may use changes while the keypad is in use,
 * as it does when a toast arrives and takes its strip from the page area.
 */
export const revealRingElementOnReserveChange = (): (() => void) => {
  let frame = 0;
  const onReserveChange = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      const current = keypadScrollAnchorEl;
      if (getInputModality() !== "key-navigation" || !current?.isConnected) return;
      if (isEditedOutside(current) || hasOpenOverlay()) return;
      if (needsReveal(current)) scrollRingElementIntoView(current);
    });
  };
  window.addEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, onReserveChange);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener(KEYPAD_GUIDANCE_RESERVE_EVENT, onReserveChange);
  };
};

const GUIDANCE_RESERVE = "--keypad-guidance-reserved-height";

/**
 * Browsers return the reserve as unevaluated `calc(...)` text, so a plain number is parsed directly
 * and anything else is measured through a hidden element that lays the value out.
 */
const guidanceBarHeight = (): number => {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(GUIDANCE_RESERVE).trim();
  if (!raw) return 0;
  const direct = Number(raw.replace(/px$/, ""));
  if (Number.isFinite(direct)) return direct;
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(${GUIDANCE_RESERVE},0px)`;
  root.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
};

const isScrollContainer = (element: Element): boolean => {
  const overflowY = getComputedStyle(element).overflowY;
  return (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight;
};

const scrollContainerOf = (element: Element): Element => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (isScrollContainer(parent)) return parent;
  }
  return document.scrollingElement ?? document.documentElement;
};

const visibleBoundsOf = (container: Element): { top: number; bottom: number } =>
  container === document.scrollingElement || container === document.documentElement
    ? { top: 0, bottom: window.innerHeight }
    : container.getBoundingClientRect();

/** Whether moving the ring from `from` to `to` leaves the area that scrolls with `from`. */
export const leavesScrollContainer = (from: Element, to: Element): boolean => !scrollContainerOf(from).contains(to);

/**
 * Scrolls toward content the ring cannot reach because no control follows it, instead of letting
 * Up or Down leave the page for the app or tab bar, or wrap to the other end. `scope` is the group being navigated, or null at page level:
 * a group only scrolls while part of it is still out of view, the page until it reaches its end.
 * Returns false when there is nothing left to show, so the ring wraps as before.
 */
const remainingScroll = (container: Element, direction: 1 | -1): number =>
  direction > 0 ? container.scrollHeight - container.clientHeight - container.scrollTop : container.scrollTop;

/**
 * How far the container can scroll in `direction` before `from` leaves the area the scroll margins
 * keep clear of the bars. Without this bound the selected stop scrolled away for several presses:
 * the SID Radio sheet's Close button, laid out at the top of its sheet, reached -1113 px.
 */
const scrollRoomKeepingInView = (from: Element, visible: { top: number; bottom: number }, direction: 1 | -1) => {
  const bounds = from.getBoundingClientRect();
  const style = getComputedStyle(from);
  return direction > 0
    ? bounds.top - (visible.top + (parseFloat(style.scrollMarginTop) || 0))
    : visible.bottom - (parseFloat(style.scrollMarginBottom) || 0) - bounds.bottom;
};

export const scrollTowardUnreachableContent = (from: Element, scope: Element | null, direction: 1 | -1): boolean => {
  const container = scrollContainerOf(from);
  const remaining = remainingScroll(container, direction);
  if (remaining < 1) return false;
  const guidanceBar = guidanceBarHeight();
  const visible = visibleBoundsOf(container);
  if (scope) {
    const bounds = scope.getBoundingClientRect();
    const hidden = direction > 0 ? bounds.bottom - (visible.bottom - guidanceBar) : visible.top - bounds.top;
    if (hidden < 1) return false;
  }
  const room = scrollRoomKeepingInView(from, visible, direction);
  if (room < 1) return false;
  // The keypad guidance bar is fixed over the bottom of the page and hides what lies under it.
  const step = Math.max(container.clientHeight - guidanceBar, 1);
  container.scrollBy({ top: direction * Math.min(remaining, step, room) });
  return true;
};

/**
 * Down on the page's last stop would leave the page for the tab bar (Up on its first, for the app
 * bar), or wrap. While the page still has content that way, it scrolls to show it instead, so text
 * below the last control is reachable without a touchscreen. Returns true when it scrolled.
 */
export const scrollInsteadOfLeavingPage = (
  focus: FocusController,
  elementForId: (id: string) => Element | null,
  direction: 1 | -1,
): boolean => {
  const current = focus.current();
  const from = current ? elementForId(current.id) : null;
  const destination = focus.peekStep(direction);
  if (!from || !destination) return false;
  const to = elementForId(destination.item.id);
  if (!destination.wraps && !(to && leavesScrollContainer(from, to))) return false;
  const scopeId = focus.currentScopeParentId();
  return scrollTowardUnreachableContent(from, scopeId ? elementForId(scopeId) : null, direction);
};

/** Less than about one control's height left to show is the body's padding, not content worth a press. */
const OVERLAY_CONTENT_THRESHOLD_PX = 44;

/**
 * A stop taller than the overlay body it scrolls in, such as a block of details, is read a page at a
 * time: the key scrolls the rest of it into view before the ring moves on, so none of it is skipped.
 */
const scrollThroughTallStop = (overlay: Element, from: Element, direction: 1 | -1): boolean => {
  const body = scrollContainerOf(from);
  if (!overlay.contains(body)) return false;
  const visible = visibleBoundsOf(body);
  const bounds = from.getBoundingClientRect();
  const hidden = direction > 0 ? bounds.bottom - visible.bottom : visible.top - bounds.top;
  if (hidden < 1) return false;
  const page = Math.max(body.clientHeight - OVERLAY_CONTENT_THRESHOLD_PX, 1);
  body.scrollBy({ top: direction * Math.min(hidden, page) });
  return true;
};

/** The overlay's own scrolling body, never the page behind it, shows what follows its last control. */
const scrollOverlayTowardUnreachableContent = (overlay: Element, from: Element, direction: 1 | -1): boolean => {
  const body = scrollContainerOf(from);
  if (!overlay.contains(body) || remainingScroll(body, direction) < OVERLAY_CONTENT_THRESHOLD_PX) return false;
  return scrollTowardUnreachableContent(from, null, direction);
};

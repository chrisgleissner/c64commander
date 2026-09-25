/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The two exclusions every global key shortcut in this app applies, in one place.
 *
 * They started inside `useFocusNavigation` and are shared now because the search key has its own
 * listener outside that provider (spec.md section 9.1) and has to apply exactly the same rules —
 * two copies of "is this a text field" is how one of them ends up wrong.
 */

/**
 * True when the event target is a text-editing element. Global navigation skips these so digits and
 * arrows reach the field (and its T9 composer) instead of being consumed for focus movement.
 */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  const editableAttr = target.getAttribute("contenteditable");
  return editableAttr !== null && editableAttr !== "false";
};

/**
 * Single-line fields, where Up/Down move focus. The caret cannot move vertically in them, and a
 * number field's own Up/Down step left a dialog's number field with no key that reached anything
 * else: digits type its value, and Back closes the dialog.
 */
const SINGLE_LINE_FIELD_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number"]);
export const isSingleLineField = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement && SINGLE_LINE_FIELD_TYPES.has(target.type);

/**
 * Radix overlays (dialog, alert dialog, dropdown/context menu, select listbox, popover) own the
 * keyboard while focus is inside them, so a global shortcut must stay inert there.
 */
export const OPEN_OVERLAY_ANCESTOR_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]';

/** True while any overlay is on screen, whether or not focus is inside it. */
export const isAnyOverlayOpen = (): boolean =>
  typeof document !== "undefined" && document.querySelector(OPEN_OVERLAY_ANCESTOR_SELECTOR) !== null;

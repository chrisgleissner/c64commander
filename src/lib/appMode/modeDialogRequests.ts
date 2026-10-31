/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ModeDialogKind = "enter" | "leave" | "sheet";

const MODE_DIALOG_EVENT = "c64u-mode-dialog-request";

/** Asks the mode dialog host to open one of its dialogs, so no caller owns a copy of them. */
export const requestModeDialog = (kind: ModeDialogKind): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ModeDialogKind>(MODE_DIALOG_EVENT, { detail: kind }));
};

export const subscribeModeDialog = (handler: (kind: ModeDialogKind) => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<ModeDialogKind>).detail);
  window.addEventListener(MODE_DIALOG_EVENT, listener);
  return () => window.removeEventListener(MODE_DIALOG_EVENT, listener);
};

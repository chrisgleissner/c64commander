/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A tiny window-event command bus for keypad-triggered global actions whose UI
 * lives in a component mounted elsewhere in the tree: the status badge's Device
 * Switcher, and the keypad Quick Menu. The keypad provider (and any caller) emits
 * a request; the owning component subscribes and opens itself. This mirrors the
 * diagnostics overlay's `requestDiagnosticsOpen` pattern and keeps the provider
 * free of component refs / prop drilling.
 */

const DEVICE_SWITCHER_OPEN_EVENT = "c64u-device-switcher-open-request";
const QUICK_MENU_OPEN_EVENT = "c64u-quick-menu-open-request";

const emit = (name: string): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
};

const subscribe = (name: string, handler: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
};

/** Ask the status badge to open the Device Switcher (keypad `#` / Menu → Switch Device). */
export const requestDeviceSwitcherOpen = (): void => emit(DEVICE_SWITCHER_OPEN_EVENT);

/** Subscribe the status badge to Device-Switcher open requests. Returns an unsubscribe. */
export const subscribeDeviceSwitcherOpen = (handler: () => void): (() => void) =>
  subscribe(DEVICE_SWITCHER_OPEN_EVENT, handler);

/** Ask the Quick Menu to open (keypad Menu key with no item context menu). */
export const requestQuickMenuOpen = (): void => emit(QUICK_MENU_OPEN_EVENT);

/** Subscribe the Quick Menu to open requests. Returns an unsubscribe. */
export const subscribeQuickMenuOpen = (handler: () => void): (() => void) => subscribe(QUICK_MENU_OPEN_EVENT, handler);

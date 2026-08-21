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

const emit = <T>(name: string, detail?: T): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
};

const subscribe = <T>(name: string, handler: (detail: T) => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<T>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
};

/** Ask the status badge to open the Device Switcher (keypad `#` / Menu → Switch Device). */
export const requestDeviceSwitcherOpen = (): void => emit(DEVICE_SWITCHER_OPEN_EVENT);

/** Subscribe the status badge to Device-Switcher open requests. Returns an unsubscribe. */
export const subscribeDeviceSwitcherOpen = (handler: () => void): (() => void) =>
  subscribe(DEVICE_SWITCHER_OPEN_EVENT, handler);

/** Ask the Quick Menu to open (keypad Menu key with no item context menu). */
/**
 * How the Quick menu was opened.
 *
 * It decides what the menu is for. Opened from the keypad's Menu key it is the only way to reach
 * the page jumps and the direct-key actions, and it names the key for each. Opened by tapping the
 * app bar it is a menu for someone holding a touchscreen, who has the tab bar in front of them —
 * repeating every page there would be a list of things they can already see.
 */
export type QuickMenuSource = "keypad" | "pointer";

export const requestQuickMenuOpen = (source: QuickMenuSource = "keypad"): void => emit(QUICK_MENU_OPEN_EVENT, source);

/** Subscribe the Quick Menu to open requests. Returns an unsubscribe. */
export const subscribeQuickMenuOpen = (handler: (source: QuickMenuSource) => void): (() => void) =>
  subscribe(QUICK_MENU_OPEN_EVENT, handler);

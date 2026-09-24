/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { App } from "@capacitor/app";

import { addLog } from "@/lib/logging";

/**
 * Turn Android's hardware Back key into a key event the app can act on.
 *
 * Capacitor delivers Back to a `backButton` listener, not to the WebView, so with no listener the
 * page sees nothing at all. Only the interstitial stack registered one, so on an ordinary page
 * Back did nothing: the keypad guidance bar said "Back — Exit", and a user who had pressed OK into
 * a card on Home could not get out of it again, which put the rest of the page out of reach.
 *
 * The event carries no key code, which is what `isDeviceBackKey` recognises it by. It is dispatched
 * at the focused element, as a real key would be, so a focused text field or dialog sees it as its
 * own. `onUnhandled` runs when nothing consumed it, which is what happens with keypad navigation
 * turned off: no dialog closed, so Back leaves the route as it would without this listener.
 */
export const installDeviceBackButton = (onUnhandled: () => void): (() => void) => {
  let removed = false;
  let remove: (() => Promise<void>) | null = null;

  void App.addListener("backButton", () => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
    (document.activeElement ?? document).dispatchEvent(event);
    if (!event.defaultPrevented) onUnhandled();
  })
    .then((handle) => {
      if (removed) void handle.remove();
      else remove = () => handle.remove();
    })
    .catch((error) => {
      addLog("warn", "Failed to register the Android Back handler; the Back key will do nothing", {
        error: error instanceof Error ? error.message : String(error ?? "Unknown listener failure"),
      });
    });

  return () => {
    removed = true;
    void remove?.();
  };
};

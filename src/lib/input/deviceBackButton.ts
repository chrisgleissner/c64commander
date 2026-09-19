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
 * The event carries no key code, which is what `isDeviceBackKey` recognises it by.
 */
export const installDeviceBackButton = (): (() => void) => {
  let removed = false;
  let remove: (() => Promise<void>) | null = null;

  void App.addListener("backButton", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
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

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { App } from "@capacitor/app";

import { addLog } from "@/lib/logging";
import { isAnyOverlayOpen } from "@/lib/input/eventTargets";

/** Sends the keydown the device Back key becomes to `target`, and returns it so the caller can see whether it was taken. */
export const dispatchDeviceBackKey = (target: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
  target.dispatchEvent(event);
  return event;
};

const CLOSING_OVERLAY_SELECTOR =
  '[data-state="closed"][role="dialog"],[data-state="closed"][role="alertdialog"],[data-state="closed"][role="menu"],[data-state="closed"][role="listbox"]';
const CLOSING_POLL_MS = 16;
const CLOSING_WAIT_LIMIT_MS = 600;

type QueuedBack = { run: () => void; deadlineMs: number };
const queuedBacks: QueuedBack[] = [];
let queuePolling = false;

const drainQueuedBacks = () => {
  queuePolling = false;
  const next = queuedBacks[0];
  if (!next) return;
  if (document.querySelector(CLOSING_OVERLAY_SELECTOR) === null || Date.now() >= next.deadlineMs) {
    queuedBacks.shift();
    next.run();
  }
  if (queuedBacks.length > 0) {
    queuePolling = true;
    window.setTimeout(drainQueuedBacks, CLOSING_POLL_MS);
  }
};

/**
 * Runs a Back press once any overlay still playing its close animation has left the DOM.
 *
 * Radix keeps a closing layer on its stack until the exit animation ends, so a second Back about
 * 50 ms after the first reached the closing layer and was absorbed; the dialog beneath it stayed
 * open. Presses wait their turn, in order, for at most {@link CLOSING_WAIT_LIMIT_MS} each.
 */
export const runBackWhenOverlaysSettled = (run: () => void): void => {
  if (queuedBacks.length === 0 && document.querySelector(CLOSING_OVERLAY_SELECTOR) === null) {
    run();
    return;
  }
  queuedBacks.push({ run, deadlineMs: Date.now() + CLOSING_WAIT_LIMIT_MS });
  if (!queuePolling) {
    queuePolling = true;
    window.setTimeout(drainQueuedBacks, CLOSING_POLL_MS);
  }
};

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

  void App.addListener("backButton", () =>
    runBackWhenOverlaysSettled(() => {
      // An overlay the key closed is the whole answer, whether or not it cancelled the event.
      const overlayWasOpen = isAnyOverlayOpen();
      const event = dispatchDeviceBackKey(document.activeElement ?? document);
      if (!event.defaultPrevented && !overlayWasOpen) onUnhandled();
    }),
  )
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

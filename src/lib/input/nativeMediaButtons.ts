/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { onBackgroundTransportCommand } from "@/lib/native/backgroundExecution";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { createTransportShortcut, type TransportShortcutOptions } from "@/lib/input/transportShortcuts";

/**
 * Route a headset, lock-screen or Bluetooth transport press to the same place F1 and F3 go: the
 * service's MediaSession relays it, and the transport shortcut factory replays it so a press with
 * Play unmounted still lands. Returns a cleanup function; a no-op off native Android.
 */
export const installNativeMediaButtons = (options: TransportShortcutOptions): (() => void) => {
  if (!isNativePlatform() || getPlatform() !== "android") return () => undefined;

  let cancelled = false;
  let handle: { remove: () => Promise<void> } | null = null;

  void onBackgroundTransportCommand((command) => {
    if (cancelled) return;
    createTransportShortcut(command, options)();
  })
    .then((registered) => {
      if (cancelled) {
        void registered.remove();
        return;
      }
      handle = registered;
    })
    .catch((error: unknown) => {
      addLog("warn", "Failed to register native media button listener", {
        source: "native-media-buttons",
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return () => {
    cancelled = true;
    void handle?.remove();
  };
};

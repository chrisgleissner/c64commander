/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";

import { addLog } from "@/lib/logging";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface WakeLockApiLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

const getWakeLockApi = (): WakeLockApiLike | null => {
  if (typeof navigator === "undefined") return null;
  const api = (navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock;
  return api && typeof api.request === "function" ? api : null;
};

/**
 * Keep the screen awake while `active`.
 *
 * Watching Live View is the one thing the app does that produces no touch input at all: the user is
 * looking at a C64 screen being driven by something else. Android's display timeout does not know
 * that, so the screen dims and locks mid-picture, and unlocking is what interrupts the thing being
 * watched.
 *
 * The Screen Wake Lock API rather than a native `FLAG_KEEP_SCREEN_ON`, because it is available in
 * the Android WebView the app already runs in, applies to the web build for free, and releases
 * itself if the WebView goes away — a window flag would have to be cleared by hand on every exit
 * path, including a crash.
 *
 * Re-acquiring on `visibilitychange` is required, not defensive: the platform revokes the sentinel
 * whenever the document is hidden and never returns it, so without this the screen stays awake on
 * the first visit to Live View and sleeps on every one after it.
 */
export const useScreenWakeLock = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    const api = getWakeLockApi();
    if (!api) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      if (cancelled || sentinel) return;
      try {
        const next = await api.request("screen");
        if (cancelled) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch (error) {
        // Denied by the platform (battery saver, no user activation). Live View still works; the
        // screen just times out as it did before.
        addLog("debug", "Live View: screen wake lock unavailable", {
          service: "streams",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        // Already revoked by the platform — drop our reference so the next return re-requests.
        sentinel = null;
        return;
      }
      void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      void held?.release().catch(() => undefined);
    };
  }, [active]);
};

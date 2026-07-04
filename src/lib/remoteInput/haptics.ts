/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A short, best-effort tactile pulse for the remote-control surfaces (joystick
 * directions/fire and virtual keyboard keys). Uses the Web Vibration API, which
 * the Android WebView exposes; absence (iOS WebView, desktop) is a silent no-op
 * so callers never have to guard. Kept tiny and centralized so every remote
 * control gives the same "I felt the press" feedback for no-look play.
 */
export const vibrateTap = (ms = 12): void => {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(ms);
  } catch (error) {
    // Best-effort only: some WebViews throw when vibration is disabled at runtime.
    void error;
  }
};

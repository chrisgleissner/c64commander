/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { primeDiagnosticsOverlaySuppression } from "@/lib/diagnostics/diagnosticsOverlayState";

/**
 * Entry presets (§12.7).
 * Controls which filters are active when the overlay opens.
 * - 'header': opened from the unified header badge (Problems + Actions, All indicators)
 * - 'settings': opened from Settings (Problems + Actions, All indicators)
 */
export type DiagnosticsEntryPreset = "header" | "settings";

const DIAGNOSTICS_OPEN_KEY = "c64u_diagnostics_open_preset";

export const requestDiagnosticsOpen = (preset: DiagnosticsEntryPreset) => {
  if (typeof window === "undefined") return;
  primeDiagnosticsOverlaySuppression();
  try {
    sessionStorage.setItem(DIAGNOSTICS_OPEN_KEY, preset);
  } catch (error) {
    console.warn("Unable to persist diagnostics open request:", error);
  }
  window.dispatchEvent(new CustomEvent("c64u-diagnostics-open-request", { detail: { preset } }));
};

export const consumeDiagnosticsOpenRequest = (): DiagnosticsEntryPreset | null => {
  if (typeof window === "undefined") return null;
  try {
    const preset = sessionStorage.getItem(DIAGNOSTICS_OPEN_KEY) as DiagnosticsEntryPreset | null;
    if (preset) {
      sessionStorage.removeItem(DIAGNOSTICS_OPEN_KEY);
      return preset;
    }
  } catch (error) {
    console.warn("Unable to consume diagnostics open request:", error);
  }
  return null;
};

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
export type DiagnosticsPanelKey =
  | "overview"
  | "latency"
  | "history"
  | "config-drift"
  | "decision-state"
  | "rest-heatmap"
  | "ftp-heatmap"
  | "config-heatmap";

export type DiagnosticsOpenRequest = {
  preset: DiagnosticsEntryPreset;
  panel?: DiagnosticsPanelKey | null;
};

const DIAGNOSTICS_OPEN_KEY = "c64u_diagnostics_open_preset";

export const clearDiagnosticsOpenRequest = () => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(DIAGNOSTICS_OPEN_KEY);
  } catch (error) {
    console.warn("Unable to clear diagnostics open request:", error);
  }
};

export const requestDiagnosticsOpen = (preset: DiagnosticsEntryPreset, panel?: DiagnosticsPanelKey | null) => {
  if (typeof window === "undefined") return;
  primeDiagnosticsOverlaySuppression();
  const request: DiagnosticsOpenRequest = {
    preset,
    panel: panel ?? null,
  };
  try {
    sessionStorage.setItem(DIAGNOSTICS_OPEN_KEY, JSON.stringify(request));
  } catch (error) {
    console.warn("Unable to persist diagnostics open request:", error);
  }
  window.dispatchEvent(new CustomEvent("c64u-diagnostics-open-request", { detail: request }));
};

export const consumeDiagnosticsOpenRequest = (): DiagnosticsOpenRequest | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(DIAGNOSTICS_OPEN_KEY);
    if (stored) {
      clearDiagnosticsOpenRequest();
      try {
        const parsed = JSON.parse(stored) as DiagnosticsOpenRequest;
        if (parsed?.preset) return parsed;
      } catch (error) {
        console.warn("Unable to parse diagnostics open request, evaluating legacy preset fallback:", error);
        if (stored === "header" || stored === "settings") {
          return { preset: stored, panel: null };
        }
      }
    }
  } catch (error) {
    console.warn("Unable to consume diagnostics open request:", error);
  }
  return null;
};

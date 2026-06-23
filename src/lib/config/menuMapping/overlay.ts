/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Layer A — the device-agnostic terminology overlay.
 *
 * Merges the terminology indexes derived from every captured menu (only C64U today)
 * into ONE `{category → {item → {label, formatterId}}}` index. The same REST
 * `{category,item}` identity recurs across device families, so a friendly label
 * captured from the C64U menu travels to ANY device that exposes that item — with no
 * per-device menu and no family gate. Consumed on every device, in both the menu-
 * hierarchy and the REST-grouped layouts.
 */

import { C64U_1_1_0_OVERLAY } from "./c64u-1.1.0.generated";
import type { TerminologyOverlay, TerminologyOverlayEntry } from "./types";
import { lookupOverlay } from "./types";

const mergeOverlays = (...overlays: TerminologyOverlay[]): TerminologyOverlay => {
  const merged: TerminologyOverlay = {};
  for (const overlay of overlays) {
    for (const [category, items] of Object.entries(overlay)) {
      const target = (merged[category] ??= {});
      for (const [item, entry] of Object.entries(items)) {
        // First writer wins (deterministic). If a future family needs a different
        // label for a shared item, scope that entry at compile time rather than here.
        if (!(item in target)) target[item] = entry;
      }
    }
  }
  return merged;
};

/** The merged Layer A overlay. */
export const TERMINOLOGY_OVERLAY: TerminologyOverlay = mergeOverlays(C64U_1_1_0_OVERLAY);

/** Resolve a friendly label + formatter for a live REST item, or `undefined`. */
export const resolveOverlayEntry = (category: string, item: string): TerminologyOverlayEntry | undefined =>
  lookupOverlay(TERMINOLOGY_OVERLAY, category, item);

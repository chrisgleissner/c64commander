/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import { isDiagnosticsOverlayActive, subscribeDiagnosticsOverlay } from "@/lib/diagnostics/diagnosticsOverlayState";

export const useDiagnosticsOverlayActive = () =>
  useSyncExternalStore(subscribeDiagnosticsOverlay, isDiagnosticsOverlayActive, isDiagnosticsOverlayActive);

import { useSyncExternalStore } from "react";
import {
    isDiagnosticsOverlayActive,
    subscribeDiagnosticsOverlay,
} from "@/lib/diagnostics/diagnosticsOverlayState";

export const useDiagnosticsOverlayActive = () =>
    useSyncExternalStore(subscribeDiagnosticsOverlay, isDiagnosticsOverlayActive, isDiagnosticsOverlayActive);

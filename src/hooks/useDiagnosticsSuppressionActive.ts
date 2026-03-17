import { useSyncExternalStore } from "react";
import {
  isDiagnosticsOverlaySuppressionArmed,
  subscribeDiagnosticsSuppression,
} from "@/lib/diagnostics/diagnosticsOverlayState";

export const useDiagnosticsSuppressionActive = () =>
  useSyncExternalStore(subscribeDiagnosticsSuppression, isDiagnosticsOverlaySuppressionArmed, () => false);

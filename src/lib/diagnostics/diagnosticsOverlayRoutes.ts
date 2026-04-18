import type { DiagnosticsPanelKey } from "@/lib/diagnostics/diagnosticsOverlay";

export const resolveDiagnosticsPanelFromPath = (pathname: string): DiagnosticsPanelKey | null => {
  if (pathname === "/diagnostics" || pathname === "/diagnostics/") return "overview";
  if (pathname === "/diagnostics/latency") return "latency";
  if (pathname === "/diagnostics/history") return "history";
  if (pathname === "/diagnostics/config-drift") return "config-drift";
  if (pathname === "/diagnostics/decision-state") return "decision-state";
  if (pathname === "/diagnostics/heatmap/rest") return "rest-heatmap";
  if (pathname === "/diagnostics/heatmap/ftp") return "ftp-heatmap";
  if (pathname === "/diagnostics/heatmap/config") return "config-heatmap";
  return null;
};

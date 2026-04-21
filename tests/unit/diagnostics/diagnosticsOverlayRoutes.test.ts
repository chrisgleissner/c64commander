// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveDiagnosticsPanelFromPath } from "@/lib/diagnostics/diagnosticsOverlayRoutes";

describe("diagnosticsOverlayRoutes", () => {
  it.each([
    ["/diagnostics", "overview"],
    ["/diagnostics/", "overview"],
    ["/diagnostics/latency", "latency"],
    ["/diagnostics/history", "history"],
    ["/diagnostics/config-drift", "config-drift"],
    ["/diagnostics/decision-state", "decision-state"],
    ["/diagnostics/heatmap/rest", "rest-heatmap"],
    ["/diagnostics/heatmap/ftp", "ftp-heatmap"],
    ["/diagnostics/heatmap/config", "config-heatmap"],
  ])("maps %s to %s", (pathname, expectedPanel) => {
    expect(resolveDiagnosticsPanelFromPath(pathname)).toBe(expectedPanel);
  });

  it("returns null for non-diagnostics paths", () => {
    expect(resolveDiagnosticsPanelFromPath("/settings")).toBeNull();
    expect(resolveDiagnosticsPanelFromPath("/diagnostics/unknown")).toBeNull();
  });
});

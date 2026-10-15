/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { explainSkippedProbe, probeDisplayName } from "@/lib/diagnostics/skippedProbeExplanation";

describe("explainSkippedProbe", () => {
  it.each([
    [
      "Skipped: switch-device-dialog does not probe Telnet (reduces device session churn)",
      "Not checked here, so this list doesn't open extra connections to your C64. To check it, open the status badge and choose Run health check.",
    ],
    [
      "Skipped: switch-device-dialog health check is read-only",
      "Not checked here, because this check changes a setting briefly and puts it back. To include it, open the status badge and choose Run health check.",
    ],
    [
      "Skipped: background-maintenance does not probe Telnet (reduces device session churn)",
      "Not checked by the automatic check, so it doesn't open extra connections to your C64. To check it, open the status badge and choose Run health check.",
    ],
    [
      "Skipped: background-maintenance health check is read-only",
      "Not checked by the automatic check, because this check changes a setting briefly and puts it back. To include it, open the status badge and choose Run health check.",
    ],
    [
      "Skipped: REST probe failed",
      "Not checked, because your C64 did not answer the first check (REST). This check needs that answer.",
    ],
    ["Device not ready for requests", "Not checked, because the app was still connecting to your C64."],
    [
      "Unsupported: readMemory failed: HTTP 404",
      "Not checked, because your C64 did not report where it is drawing the screen.",
    ],
  ])("explains %j in plain language", (reason, explanation) => {
    expect(explainSkippedProbe(reason)).toBe(explanation);
  });

  it("passes an unknown reason through rather than hiding it", () => {
    expect(explainSkippedProbe("  Something new  ")).toBe("Something new");
  });

  it("has nothing to explain without a reason", () => {
    expect(explainSkippedProbe(null)).toBeNull();
    expect(explainSkippedProbe("   ")).toBeNull();
  });

  it("names probes in sentence case for their info buttons", () => {
    expect(["REST", "FTP", "TELNET", "CONFIG", "RASTER", "JIFFY", "custom"].map(probeDisplayName)).toEqual([
      "REST",
      "FTP",
      "Telnet",
      "Config",
      "Raster",
      "Jiffy",
      "custom",
    ]);
  });
});

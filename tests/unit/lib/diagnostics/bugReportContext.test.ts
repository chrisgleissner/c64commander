/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildDiagnosticsBugReportContext, parseAndroidVersionFromUserAgent } from "@/lib/diagnostics/bugReportContext";

describe("bugReportContext", () => {
  it("parses the Android version from a WebView user agent", () => {
    expect(
      parseAndroidVersionFromUserAgent(
        "Mozilla/5.0 (Linux; Android 13; Pixel 4 Build/TQ3A.230805.001; wv) AppleWebKit/537.36",
      ),
    ).toBe("13");
  });

  it("includes explicit bug-report metadata required by the diagnostics policy", () => {
    const context = buildDiagnosticsBugReportContext({
      activeDeviceHost: "192.168.1.13",
      activeDeviceLabel: "u64",
      deviceInfo: {
        product: "U64E",
        firmware_version: "3.14e",
        fpga_version: "122",
        core_version: "1.4B",
      },
      deviceSafetyResolution: {
        storedMode: "AUTO",
        effectiveMode: "BALANCED",
      },
      buildInfo: {
        appVersion: "0.7.9-rc1",
        versionLabel: "0.7.9-rc1-1-gabcdef0",
        gitSha: "abcdef0123456789",
        gitShaShort: "abcdef01",
        buildTimeUtc: "2026-06-11 13:00:00 UTC",
      },
      platform: "android",
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 4 Build/TQ3A.230805.001; wv)",
      networkSnapshot: {
        requests: [
          {
            hostname: "192.168.1.13",
            resolvedIp: "192.168.1.13",
            port: 80,
            protocol: "http",
            durationMs: 42,
            httpStatus: 200,
            errorDomain: null,
            errorCode: null,
            errorMessage: null,
            retryCount: 0,
            url: "http://192.168.1.13/v1/info",
            method: "GET",
            timestamp: "2026-06-11T13:00:00.000Z",
          },
        ],
        successCount: 1,
        failureCount: 0,
      },
    });

    expect(context).toMatchObject({
      app: {
        version: "0.7.9-rc1",
        versionLabel: "0.7.9-rc1-1-gabcdef0",
        gitSha: "abcdef0123456789",
        gitShaShort: "abcdef01",
        buildTimeUtc: "2026-06-11 13:00:00 UTC",
      },
      platform: {
        capacitorPlatform: "android",
        androidVersion: "13",
      },
      activeDevice: {
        host: "192.168.1.13",
        label: "u64",
        product: "U64E",
        firmware: "3.14e",
        fpga: "122",
        core: "1.4B",
      },
      deviceSafety: {
        storedMode: "AUTO",
        effectiveMode: "BALANCED",
      },
      networkSnapshot: {
        successCount: 1,
        failureCount: 0,
      },
    });
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  isAlwaysExpectedFuzzBehavior,
  isDeviceOperationFailure,
  shouldIgnoreBackendFailure,
  type AppLogEntry,
  type BackendFailureContext,
} from "../../../playwright/fuzz/fuzzBackend";

const makeEntry = (message: string, level = "warn"): AppLogEntry => ({
  id: "test-id",
  level,
  message,
});

const nominalContext = (): BackendFailureContext => ({
  now: Date.now(),
  serverReachable: true,
  networkOffline: false,
  faultMode: "none",
  lastOutageAt: 0,
});

describe("isAlwaysExpectedFuzzBehavior", () => {
  it.each([
    // Fuzz-mode blocking
    "Fuzz mode blocked request",
    "fuzz mode blocked real device request",
    // Infrastructure noise — no native bridge, host cycling, HVSC absent
    "DiagnosticsBridge unavailable; native diagnostics mirroring disabled",
    "Category config fetch failed; falling back to item fetches",
    "API device host changed",
    "C64 API retry scheduled after idle failure",
    "Songlengths unavailable",
    "HVSC filesystem: Filesystem read directory failed",
    "HVSC paged folder listing failed; falling back to runtime",
    "HVSC songlengths directory bootstrap failed",
    "HVSC progress interrupted",
    "Failed to capture initial config snapshot: Error: Host unreachable",
    "Failed to fetch category C64 and Cartridge Settings: Error: HTTP 503",
    "[fuzz] localStorage init failed: access denied",
    // Device operation failures — mock server returns HTTP 404 for hardware endpoints
    "HOME_CPU_SPEED: Update failed",
    "RESET_DRIVES: Drive reset failed",
    "C64 API request failed",
  ])('returns true for "%s"', (msg) => {
    expect(isAlwaysExpectedFuzzBehavior(makeEntry(msg))).toBe(true);
  });

  it.each(["Some unrelated log message", "User tapped the pause button"])(
    'returns false for "%s"',
    (msg) => {
      expect(isAlwaysExpectedFuzzBehavior(makeEntry(msg))).toBe(false);
    },
  );
});

describe("isDeviceOperationFailure", () => {
  it.each([
    "HOME_CPU_SPEED: Update failed",
    "HOME_MACHINE_SAVE_RAM: Machine action failed",
    "HOME_VIDEO_BLACK_LINES: action rejected",
    "RESET_DRIVES: Drive reset failed",
    "DRIVE_POWER: Drive power toggle failed",
    "DRIVE_CONFIG_UPDATE: Update failed",
    "SOFT_IEC_CONFIG_UPDATE: IEC config error",
    "RAM_DUMP_FOLDER_SELECT: Selection failed",
    "BROWSE: navigation error",
    "CONFIG_UPDATE: save error",
    "FTP listing failed: timeout",
    "Source browse failed",
    "C64 API request failed: 503",
    "C64 API upload failed: connection refused",
    "RAM operation retry 3/5",
    "Failed to resume machine after clear-memory error",
    "HVSC paged folder listing failed; falling back to runtime",
    "HVSC songlengths directory bootstrap failed",
    "HVSC progress interrupted by new request",
    "AUDIO_ROUTING: Audio routing error",
    "AUDIO_ROUTING: Solo routing update failed",
  ])('returns true for "%s"', (msg) => {
    expect(isDeviceOperationFailure(makeEntry(msg))).toBe(true);
  });

  it.each([
    "DiagnosticsBridge unavailable",
    "Category config fetch failed",
    "Some completely unrelated log",
    "User opened the settings page",
  ])('returns false for "%s"', (msg) => {
    expect(isDeviceOperationFailure(makeEntry(msg))).toBe(false);
  });
});

describe("shouldIgnoreBackendFailure", () => {
  it("ignores explicit fuzz safety block logs regardless of nominal context", () => {
    expect(
      shouldIgnoreBackendFailure(
        makeEntry("Fuzz mode blocked request"),
        nominalContext(),
      ),
    ).toBe(true);
  });

  it("ignores device operation failure regardless of fault mode", () => {
    expect(
      shouldIgnoreBackendFailure(makeEntry("HOME_CPU_SPEED: Update failed"), {
        ...nominalContext(),
        faultMode: "timeout",
      }),
    ).toBe(true);
  });

  it("ignores device operation failure regardless of server reachability", () => {
    expect(
      shouldIgnoreBackendFailure(makeEntry("C64 API request failed"), {
        ...nominalContext(),
        serverReachable: false,
      }),
    ).toBe(true);
  });

  it("ignores device operation failure regardless of network state", () => {
    expect(
      shouldIgnoreBackendFailure(
        makeEntry("RESET_DRIVES: Drive reset failed"),
        {
          ...nominalContext(),
          networkOffline: true,
        },
      ),
    ).toBe(true);
  });

  it("ignores device operation failure regardless of post-outage window", () => {
    const now = Date.now();
    expect(
      shouldIgnoreBackendFailure(
        makeEntry("DRIVE_POWER: Drive power toggle failed"),
        {
          now,
          serverReachable: true,
          networkOffline: false,
          faultMode: "none",
          lastOutageAt: now - 5000,
        },
      ),
    ).toBe(true);
  });

  it("ignores device operation failure with fully nominal context", () => {
    expect(
      shouldIgnoreBackendFailure(
        makeEntry("HOME_CPU_SPEED: Update failed"),
        nominalContext(),
      ),
    ).toBe(true);
  });

  it("does not ignore unknown log with nominal context", () => {
    expect(
      shouldIgnoreBackendFailure(
        makeEntry("Some unexpected log message"),
        nominalContext(),
      ),
    ).toBe(false);
  });

  it("ignores c64 api request failed with HTTP 503 text", () => {
    const entry: AppLogEntry = {
      id: "x",
      level: "error",
      message: "C64 API request failed",
      details: { rawError: "HTTP 503 service unavailable" },
    };
    expect(shouldIgnoreBackendFailure(entry, nominalContext())).toBe(true);
  });

  it("ignores c64 api request failed with net::ERR text", () => {
    const entry: AppLogEntry = {
      id: "y",
      level: "error",
      message: "C64 API request failed",
      details: { rawError: "net::ERR_CONNECTION_REFUSED" },
    };
    expect(shouldIgnoreBackendFailure(entry, nominalContext())).toBe(true);
  });

  it("ignores device operation failure when details.error is an object with HTTP 503 message", () => {
    const entry: AppLogEntry = {
      id: "z",
      level: "error",
      message: "HOME_MACHINE_PAUSE_RESUME: Machine action failed",
      details: {
        error: {
          name: "Error",
          message: "HTTP 503: Service Unavailable",
          stack: "Error...",
        },
      },
    };
    expect(shouldIgnoreBackendFailure(entry, nominalContext())).toBe(true);
  });

  it("ignores device operation failure when details.description contains service unavailable", () => {
    const entry: AppLogEntry = {
      id: "a1",
      level: "error",
      message: "AUDIO_ROUTING: Audio routing error",
      details: { description: "HTTP 503: Service Unavailable" },
    };
    expect(shouldIgnoreBackendFailure(entry, nominalContext())).toBe(true);
  });
});

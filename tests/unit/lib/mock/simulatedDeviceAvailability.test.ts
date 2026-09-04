/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSimulatedDeviceAvailable } from "@/lib/mock/mockServer";
import { isNativePlatform } from "@/lib/native/platform";

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: vi.fn(() => true),
  getPlatform: vi.fn(() => "android"),
}));

type ProbeWindow = Window & { __c64uMockServerBaseUrl?: string; __c64uTestProbeEnabled?: boolean };

beforeEach(() => {
  vi.mocked(isNativePlatform).mockReturnValue(true);
});

afterEach(() => {
  delete (window as ProbeWindow).__c64uMockServerBaseUrl;
  delete (window as ProbeWindow).__c64uTestProbeEnabled;
});

describe("simulated device availability (HARD27-027)", () => {
  it("is available on a native build, which hosts the mock server itself", () => {
    expect(isSimulatedDeviceAvailable()).toBe(true);
  });

  it("is unavailable in a browser, where Demo Mode would target the real host", () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
    expect(isSimulatedDeviceAvailable()).toBe(false);
  });

  it("is available in a browser that was given a mock server or runs test probes", () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);

    (window as ProbeWindow).__c64uMockServerBaseUrl = "http://127.0.0.1:45999";
    expect(isSimulatedDeviceAvailable()).toBe(true);

    delete (window as ProbeWindow).__c64uMockServerBaseUrl;
    (window as ProbeWindow).__c64uTestProbeEnabled = true;
    expect(isSimulatedDeviceAvailable()).toBe(true);
  });
});

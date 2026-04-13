/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => "web",
  isNativePlatform: () => false,
}));

import {
  getTraceContextSnapshot,
  setTraceDeviceAttributionContext,
  setTraceDeviceConnectionState,
  setTraceFeatureFlags,
  setTracePlatformContext,
  setTracePlaybackContext,
  setTraceUiContext,
  subscribeTraceContext,
} from "@/lib/tracing/traceContext";

describe("traceContext", () => {
  it("updates snapshot fields and notifies subscribers", () => {
    const updates: Array<ReturnType<typeof getTraceContextSnapshot>> = [];
    const unsubscribe = subscribeTraceContext((next) => updates.push(next));

    setTraceUiContext("/settings", "?mode=demo");
    setTracePlatformContext("android");
    setTraceFeatureFlags({ hvsc_enabled: true });
    setTracePlaybackContext({
      queueLength: 1,
      currentIndex: 0,
      currentItemId: "1",
      isPlaying: true,
      elapsedMs: 1000,
    });
    setTraceDeviceAttributionContext({
      savedDeviceId: "saved-1",
      savedDeviceNameSnapshot: "Office U64",
      savedDeviceHostSnapshot: "office-u64",
      verifiedUniqueId: "dev-1",
      verifiedHostname: "office-u64",
      verifiedProduct: "U64",
    });
    setTraceDeviceConnectionState("READY");

    const snapshot = getTraceContextSnapshot();
    expect(snapshot.ui.route).toBe("/settings");
    expect(snapshot.platform).toBe("android");
    expect(snapshot.featureFlags.hvsc_enabled).toBe(true);
    expect(snapshot.playback?.currentItemId).toBe("1");
    expect(snapshot.device?.savedDeviceId).toBe("saved-1");
    expect(snapshot.device?.verifiedUniqueId).toBe("dev-1");
    expect(snapshot.device?.connectionState).toBe("READY");
    expect(updates.length).toBeGreaterThan(1);

    unsubscribe();
  });
});

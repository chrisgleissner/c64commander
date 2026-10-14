/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ notifications: "prompt" as string })),
  requestPermissions: vi.fn(async () => ({ notifications: "granted" as string })),
  addLog: vi.fn(),
  isNativePlatform: vi.fn(() => true),
  getPlatform: vi.fn(() => "android"),
  connectionState: { current: "REAL_CONNECTED" as string },
  interstitialActive: { current: false },
  tourActive: { current: false },
  tourOfferPending: { current: false },
  playbackActive: { current: false },
}));

vi.mock("@/lib/native/backgroundExecution", () => ({
  NOTIFICATIONS_PERMISSION_ALIAS: "notifications",
  BackgroundExecution: {
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
  },
}));
vi.mock("@/lib/logging", () => ({ addLog: mocks.addLog }));
vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: mocks.isNativePlatform,
  getPlatform: mocks.getPlatform,
}));
vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ state: mocks.connectionState.current }),
}));
vi.mock("@/components/ui/interstitial-state", () => ({
  useInterstitialActive: () => mocks.interstitialActive.current,
}));
vi.mock("@/hooks/useTourActive", () => ({ useTourActive: () => mocks.tourActive.current }));
vi.mock("@/hooks/useActivePlayback", () => ({
  useActivePlayback: () => ({
    local: mocks.playbackActive.current,
    remote: false,
    any: mocks.playbackActive.current,
  }),
}));
vi.mock("@/lib/tour/tourState", () => ({
  loadTourState: () => ({}),
  shouldOfferTourOnLaunch: () => mocks.tourOfferPending.current,
}));

const loadComponent = () => import("@/components/NotificationPermissionMoment");

const mountMoment = async () => {
  const { NotificationPermissionMoment, NOTIFICATION_PERMISSION_SETTLE_MS } = await loadComponent();
  const view = render(<NotificationPermissionMoment />);
  return {
    settleMs: NOTIFICATION_PERMISSION_SETTLE_MS,
    rerender: () => view.rerender(<NotificationPermissionMoment />),
  };
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("NotificationPermissionMoment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue("android");
    mocks.checkPermissions.mockResolvedValue({ notifications: "prompt" });
    mocks.requestPermissions.mockResolvedValue({ notifications: "granted" });
    mocks.connectionState.current = "REAL_CONNECTED";
    mocks.interstitialActive.current = false;
    mocks.tourActive.current = false;
    mocks.tourOfferPending.current = false;
    mocks.playbackActive.current = false;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("asks once the connection has settled for the settle delay", async () => {
    const { settleMs } = await mountMoment();

    await advance(settleMs - 1);
    expect(mocks.requestPermissions).not.toHaveBeenCalled();

    await advance(1);
    expect(mocks.requestPermissions).toHaveBeenCalledWith({ permissions: ["notifications"] });
  });

  it("waits for the first connection before asking", async () => {
    mocks.connectionState.current = "DISCOVERING";
    const { settleMs, rerender } = await mountMoment();
    await advance(settleMs * 4);
    expect(mocks.checkPermissions).not.toHaveBeenCalled();

    mocks.connectionState.current = "DEMO_ACTIVE";
    rerender();
    await advance(settleMs);
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a dialog is open",
      () => (mocks.interstitialActive.current = true),
      () => (mocks.interstitialActive.current = false),
    ],
    ["the tour is running", () => (mocks.tourActive.current = true), () => (mocks.tourActive.current = false)],
    [
      "the first-launch tour has not been offered yet",
      () => (mocks.tourOfferPending.current = true),
      () => (mocks.tourOfferPending.current = false),
    ],
    ["a tune is playing", () => (mocks.playbackActive.current = true), () => (mocks.playbackActive.current = false)],
  ])("holds the prompt while %s and asks once that ends", async (_label, begin, end) => {
    begin();
    const { settleMs, rerender } = await mountMoment();
    await advance(settleMs * 4);
    expect(mocks.checkPermissions).not.toHaveBeenCalled();

    end();
    rerender();
    await advance(settleMs);
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it("does not ask when playback starts before the settle delay has run out", async () => {
    const { settleMs, rerender } = await mountMoment();
    await advance(settleMs / 2);

    mocks.playbackActive.current = true;
    rerender();
    await advance(settleMs * 4);

    expect(mocks.checkPermissions).not.toHaveBeenCalled();
  });

  it("asks only once per session when the connection drops and returns", async () => {
    const { settleMs, rerender } = await mountMoment();
    await advance(settleMs);

    mocks.connectionState.current = "OFFLINE_NO_DEMO";
    rerender();
    await advance(settleMs);
    mocks.connectionState.current = "REAL_CONNECTED";
    rerender();
    await advance(settleMs);

    expect(mocks.checkPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it("does not ask again after the user has refused", async () => {
    mocks.checkPermissions.mockResolvedValue({ notifications: "denied" });
    const { settleMs } = await mountMoment();
    await advance(settleMs);

    expect(mocks.checkPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it.each([
    ["the web build", false, "web"],
    ["iOS", true, "ios"],
  ])("never asks on %s", async (_label, native, platform) => {
    mocks.isNativePlatform.mockReturnValue(native);
    mocks.getPlatform.mockReturnValue(platform);
    const { settleMs } = await mountMoment();
    await advance(settleMs * 4);

    expect(mocks.checkPermissions).not.toHaveBeenCalled();
  });
});

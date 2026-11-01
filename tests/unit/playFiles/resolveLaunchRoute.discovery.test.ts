/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: "DISCOVERING" as string,
  settle: vi.fn(async () => "settled" as const),
  resolveLocalRoute: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connection/connectionManager")>();
  return { ...actual, getConnectionSnapshot: () => ({ ...actual.getConnectionSnapshot(), state: mocks.state }) };
});
vi.mock("@/lib/connection/connectionSettle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/connection/connectionSettle")>()),
  waitForDiscoveryToSettle: mocks.settle,
}));
vi.mock("@/pages/playFiles/resolveLocalRoute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/pages/playFiles/resolveLocalRoute")>()),
  resolveLocalRoute: mocks.resolveLocalRoute,
}));

import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { resolveLaunchRoute, type LaunchRouteInput } from "@/pages/playFiles/resolveLaunchRoute";
import type { LocalRouteInput } from "@/pages/playFiles/resolveLocalRoute";
import type { PlaylistItem } from "@/pages/playFiles/types";

const file = new File([new Uint8Array(8)], "tune.sid");

const input = (overrides: Partial<LaunchRouteInput> = {}): LaunchRouteInput => ({
  item: { id: "a", category: "sid", label: "Comic Bakery" } as PlaylistItem,
  request: { source: "local", path: "/tune.sid", file, songNr: 1 } as LaunchRouteInput["request"],
  path: "/tune.sid",
  deviceOutOfReach: false,
  takePrefetched: () => null,
  passOver: false,
  accepted: false,
  stillWanted: () => true,
  notify: vi.fn(),
  onDeclined: vi.fn(),
  ...overrides,
});

const routeInput = (): LocalRouteInput => mocks.resolveLocalRoute.mock.calls.at(-1)![0] as LocalRouteInput;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.settle.mockClear();
  mocks.settle.mockResolvedValue("settled");
  mocks.resolveLocalRoute.mockReset();
  mocks.resolveLocalRoute.mockResolvedValue(true);
  mocks.state = "DISCOVERING";
  localStorage.clear();
  localStorage.setItem("c64u_local_engine_enabled", "1");
  localStorage.setItem("c64u_playback_engine", "local");
  vi.spyOn(LocalSidPlaybackController, "isSupported").mockReturnValue(true);
});

describe("resolveLaunchRoute while the connection is still being discovered", () => {
  it.each(["UNKNOWN", "DISCOVERING"])(
    "offers to wait for the C64 in the state %s, and does not wait by itself",
    async (state) => {
      mocks.state = state;

      await resolveLaunchRoute(input());

      expect(routeInput().c64Usable).toBe(true);
      expect(routeInput().settleC64).toBeTypeOf("function");
      expect(mocks.settle).not.toHaveBeenCalled();
    },
  );

  it.each(["REAL_CONNECTED", "OFFLINE_NO_DEMO", "DEMO_ACTIVE"])(
    "offers nothing to wait for in the settled state %s",
    async (state) => {
      mocks.state = state;

      await resolveLaunchRoute(input());

      expect(routeInput().settleC64).toBeUndefined();
    },
  );

  it("says a C64 can play the song when discovery ends with a connected device", async () => {
    await resolveLaunchRoute(input());
    mocks.state = "REAL_CONNECTED";

    expect(await routeInput().settleC64!()).toBe(true);
    expect(mocks.settle).toHaveBeenCalledTimes(1);
  });

  it.each(["OFFLINE_NO_DEMO", "DEMO_ACTIVE"])(
    "says no C64 can play the song when discovery ends as %s",
    async (state) => {
      await resolveLaunchRoute(input());
      mocks.state = state;

      expect(await routeInput().settleC64!()).toBe(false);
    },
  );

  it("says no C64 can play the song when discovery has not ended at the bound", async () => {
    mocks.settle.mockResolvedValue("timeout");
    await resolveLaunchRoute(input());

    expect(await routeInput().settleC64!()).toBe(false);
  });

  it("says no C64 can play the song when the device is out of reach, whatever discovery says", async () => {
    await resolveLaunchRoute(input({ deviceOutOfReach: true }));
    mocks.state = "REAL_CONNECTED";

    expect(await routeInput().settleC64!()).toBe(false);
  });
});

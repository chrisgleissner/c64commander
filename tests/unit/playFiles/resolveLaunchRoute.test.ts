/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: "REAL_CONNECTED",
  resolveLocalRoute: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connection/connectionManager")>();
  return { ...actual, getConnectionSnapshot: () => ({ ...actual.getConnectionSnapshot(), state: mocks.connection }) };
});
vi.mock("@/pages/playFiles/resolveLocalRoute", () => ({
  isC64UsableForSid: () => true,
  resolveLocalRoute: mocks.resolveLocalRoute,
}));

import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { resolveLaunchRoute, type LaunchRouteInput } from "@/pages/playFiles/resolveLaunchRoute";
import { setMaySoundWrong, useMaySoundWrong } from "@/pages/playFiles/maySoundWrongStore";
import type { PlaylistItem } from "@/pages/playFiles/types";

const file = new File([new Uint8Array(8)], "tune.sid");

const input = (): LaunchRouteInput => ({
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
});

const shown = () => renderHook(() => useMaySoundWrong()).result;

describe("resolveLaunchRoute and the may sound wrong flag", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.resolveLocalRoute.mockReset();
    mocks.connection = "REAL_CONNECTED";
    localStorage.clear();
    localStorage.setItem("c64u_local_engine_enabled", "1");
    localStorage.setItem("c64u_playback_engine", "local");
    vi.spyOn(LocalSidPlaybackController, "isSupported").mockReturnValue(true);
    setMaySoundWrong(false);
  });

  it("raises the flag when the song plays on the phone despite needing ROMs it lacks", async () => {
    mocks.resolveLocalRoute.mockResolvedValue({ routeToLocal: true, maySoundWrong: true });
    const flag = shown();

    expect(await resolveLaunchRoute(input())).toMatchObject({ routeToLocal: true, maySoundWrong: true });

    expect(flag.current).toBe(true);
  });

  it.each([
    ["the local engine is switched off, so the C64 plays it", { enabled: "0", engine: "local" }],
    ["playback is set to the C64", { enabled: "1", engine: "c64" }],
  ])("lowers the flag a previous launch left up when %s", async (_name, { enabled, engine }) => {
    localStorage.setItem("c64u_local_engine_enabled", enabled);
    localStorage.setItem("c64u_playback_engine", engine);
    setMaySoundWrong(true);
    const flag = shown();

    expect(await resolveLaunchRoute(input())).toMatchObject({ routeToLocal: false, maySoundWrong: false });

    expect(mocks.resolveLocalRoute).not.toHaveBeenCalled();
    expect(flag.current).toBe(false);
  });

  it("leaves the flag as it was when the listener cancels, because what was playing carries on", async () => {
    mocks.resolveLocalRoute.mockResolvedValue(null);
    setMaySoundWrong(true);
    const flag = shown();

    expect(await resolveLaunchRoute(input())).toBeNull();

    expect(flag.current).toBe(true);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistItem } from "@/pages/playFiles/types";

const remembered = vi.hoisted(() => new Set<string>());

const engine = vi.hoisted(() => ({ supported: true }));

vi.mock("@/lib/playback/playbackRouter", () => ({
  getRememberedUltimateSidBlob: (path: string) => (remembered.has(path) ? new Blob() : null),
}));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  LocalSidPlaybackController: { isSupported: () => engine.supported },
}));

const connection = vi.hoisted(() => ({ state: "REAL_CONNECTED", simulated: false }));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: connection.state }),
  isSimulatedDeviceTarget: () => connection.simulated,
}));

import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { recordNetworkStatus, resetNetworkStatusWatchForTests } from "@/lib/connection/networkStatusWatch";
import {
  canPlayWithoutDevice,
  firstPlayableWithoutDevice,
  isDeviceOutOfReach,
  needsDeviceToPlay,
  reachableStartIndex,
} from "@/pages/playFiles/playableWithoutDevice";

const item = (id: string, source: string, category = "sid", extra: Record<string, unknown> = {}) =>
  ({ id, category, path: `/${id}.sid`, request: { source, path: `/${id}.sid`, ...extra } }) as unknown as PlaylistItem;

describe("playing without the device", () => {
  beforeEach(() => {
    remembered.clear();
    connection.state = "REAL_CONNECTED";
    connection.simulated = false;
    resetNetworkStatusWatchForTests();
  });
  afterEach(() => resetNetworkStatusWatchForTests());

  /*
   * Demo Mode runs its device inside this process, behind a loopback address, so a phone with its
   * radios off still reaches it — and a phone with its radios off is how most Demo Mode sessions
   * start. While this returned true there, pressing play on a demo tune ended at "Device not
   * connected. Check connection settings." and the demo played nothing at all.
   */
  it("calls the device out of reach when the phone has no network", () => {
    recordNetworkStatus({ online: true, supported: true });
    recordNetworkStatus({ online: false, supported: true });
    expect(isDeviceOutOfReach()).toBe(true);
  });

  it("does not call the simulated device out of reach, whatever the radios are doing", () => {
    connection.simulated = true;
    recordNetworkStatus({ online: true, supported: true });
    recordNetworkStatus({ online: false, supported: true });
    expect(isDeviceOutOfReach()).toBe(false);
  });

  it("does not call the simulated device out of reach when the snapshot says there is no demo", () => {
    connection.simulated = true;
    connection.state = "OFFLINE_NO_DEMO";
    expect(isDeviceOutOfReach()).toBe(false);
  });

  it("plays a SID from the phone, or one read from the Ultimate before the device went, and nothing else", () => {
    remembered.add("/kept.sid");

    expect(canPlayWithoutDevice(item("hvsc", "hvsc"))).toBe(true);
    expect(canPlayWithoutDevice(item("kept", "ultimate"))).toBe(true);
    expect(canPlayWithoutDevice(item("unread", "ultimate"))).toBe(false);
    expect(canPlayWithoutDevice(item("game", "local", "prg"))).toBe(false);
    expect(canPlayWithoutDevice(undefined)).toBe(false);
  });

  it("plays an archive tune without a network only when its bytes are already on the phone", () => {
    recordNetworkStatus({ online: true, supported: true });
    recordNetworkStatus({ online: false, supported: true });

    expect(canPlayWithoutDevice(item("fetched", "commoserve", "sid", { file: {} }))).toBe(true);
    expect(canPlayWithoutDevice(item("remote", "commoserve"))).toBe(false);
  });

  it("finds the next track that can play, and gives up after going round the playlist once", () => {
    const playlist = [item("a", "ultimate"), item("b", "ultimate"), item("c", "hvsc")];
    const wrapping = (from: number) => (from + 1) % playlist.length;

    expect(firstPlayableWithoutDevice(playlist, 0, wrapping)).toBe(2);
    playlist[2] = item("c", "ultimate");
    expect(firstPlayableWithoutDevice(playlist, 0, wrapping)).toBeNull();
  });
});

describe("SID Player and rows the phone cannot play", () => {
  beforeEach(() => {
    remembered.clear();
    connection.state = "OFFLINE_NO_DEMO";
    connection.simulated = false;
  });

  it("SPM-PLAY-03 SID Player skips a program row", () => {
    const playlist = [item("game", "local", "prg"), item("tune", "local")];
    expect(firstPlayableWithoutDevice(playlist, 0, (from) => (from + 1 < playlist.length ? from + 1 : null))).toBe(1);
  });

  it("SPM-PLAY-03 a playlist of only programs has nothing to play", () => {
    const playlist = [item("a", "local", "prg"), item("b", "local", "d64")];
    expect(
      firstPlayableWithoutDevice(playlist, 0, (from) => (from + 1 < playlist.length ? from + 1 : null)),
    ).toBeNull();
  });

  it("SPM-PLAY-03 needsDeviceToPlay names programs and tunes only the Ultimate holds", () => {
    expect(needsDeviceToPlay(item("game", "local", "prg"))).toBe(true);
    expect(needsDeviceToPlay(item("tune", "local"))).toBe(false);
    expect(needsDeviceToPlay(item("held", "ultimate"))).toBe(true);
    remembered.add("/held.sid");
    expect(needsDeviceToPlay(item("held", "ultimate"))).toBe(false);
  });

  it("SPM-PLAY-03 a SID is marked as needing the device where the on-device engine is unavailable", () => {
    engine.supported = false;
    try {
      expect(needsDeviceToPlay(item("tune", "local"))).toBe(true);
      expect(canPlayWithoutDevice(item("tune", "local"))).toBe(false);
    } finally {
      engine.supported = true;
    }
  });

  it("SPM-PLAY-03 a pressed program row starts at the next row the phone can play, only in SID Player", () => {
    const playlist = [item("game", "local", "prg"), item("tune", "local")];
    saveStartupModeByUser("sid-player");
    try {
      expect(reachableStartIndex(playlist, 0)).toBe(1);
      expect(reachableStartIndex([playlist[0]], 0)).toBe(0);
    } finally {
      saveStartupModeByUser("default");
    }
    expect(reachableStartIndex(playlist, 0)).toBe(0);
  });
});

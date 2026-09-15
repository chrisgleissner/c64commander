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

vi.mock("@/lib/playback/playbackRouter", () => ({
  getRememberedUltimateSidBlob: (path: string) => (remembered.has(path) ? new Blob() : null),
}));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  LocalSidPlaybackController: { isSupported: () => true },
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: "REAL_CONNECTED" }),
}));

import { recordNetworkStatus, resetNetworkStatusWatchForTests } from "@/lib/connection/networkStatusWatch";
import { canPlayWithoutDevice, firstPlayableWithoutDevice } from "@/pages/playFiles/playableWithoutDevice";

const item = (id: string, source: string, category = "sid", extra: Record<string, unknown> = {}) =>
  ({ id, category, path: `/${id}.sid`, request: { source, path: `/${id}.sid`, ...extra } }) as unknown as PlaylistItem;

describe("playing without the device", () => {
  beforeEach(() => {
    remembered.clear();
    resetNetworkStatusWatchForTests();
  });
  afterEach(() => resetNetworkStatusWatchForTests());

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

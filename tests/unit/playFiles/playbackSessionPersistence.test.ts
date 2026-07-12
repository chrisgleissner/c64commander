/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  clearPersistedPauseMute,
  discardPlaybackSnapshot,
  hydratePlaybackSnapshot,
  persistPauseMuteSnapshot,
  persistPlaybackSnapshot,
} from "@/pages/playFiles/playbackSessionPersistence";

describe("playbackSessionPersistence", () => {
  beforeEach(() => {
    if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  });

  it("round-trips a snapshot envelope for the matching device id", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7, "SID Volume Right": 8 },
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });

    const hydrated = hydratePlaybackSnapshot("device-a");
    expect(hydrated).not.toBeNull();
    expect(hydrated?.volumeSnapshot).toEqual({ "SID Volume Left": 7, "SID Volume Right": 8 });
    expect(hydrated?.volumeActive).toBe(true);
  });

  // HARD12-006: a snapshot persisted for device A must NOT be returned for
  // device B. Without the per-device guard, switching to a new saved device
  // could rehydrate the previous device's captured snapshot back into Play
  // and Stop would restore the wrong device's mixer.
  it("does not hydrate a snapshot that belongs to a different device id", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });

    const hydrated = hydratePlaybackSnapshot("device-b");
    expect(hydrated).toBeNull();
  });

  it("discardPlaybackSnapshot clears the stored envelope", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });

    discardPlaybackSnapshot("device-a");

    expect(hydratePlaybackSnapshot("device-a")).toBeNull();
  });

  it("discardPlaybackSnapshot clears the stored envelope when no device id is provided", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });

    discardPlaybackSnapshot();

    expect(sessionStorage.getItem("c64u.playbackSessionSnapshot")).toBeNull();
  });

  it("discardPlaybackSnapshot preserves a snapshot that belongs to a different device id", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });

    discardPlaybackSnapshot("device-b");

    expect(hydratePlaybackSnapshot("device-a")).toEqual({
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });
  });

  it("returns null when sessionStorage has no envelope", () => {
    expect(hydratePlaybackSnapshot("device-x")).toBeNull();
  });

  it("silently tolerates a corrupt envelope by returning null", () => {
    sessionStorage.setItem("c64u.playbackSessionSnapshot", "this-is-not-json");
    expect(hydratePlaybackSnapshot("device-x")).toBeNull();
  });

  it("returns null when the stored envelope is missing a volume snapshot", () => {
    sessionStorage.setItem(
      "c64u.playbackSessionSnapshot",
      JSON.stringify({
        deviceId: "device-a",
        volumeActive: true,
      }),
    );

    expect(hydratePlaybackSnapshot("device-a")).toBeNull();
  });

  it("hydrates null manual and pause mute fields from a partial stored envelope", () => {
    sessionStorage.setItem(
      "c64u.playbackSessionSnapshot",
      JSON.stringify({
        deviceId: "device-a",
        volumeSnapshot: { "SID Volume Left": 9 },
        volumeActive: 1,
      }),
    );

    expect(hydratePlaybackSnapshot("device-a")).toEqual({
      volumeSnapshot: { "SID Volume Left": 9 },
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });
  });

  it("persistPauseMuteSnapshot preserves the existing playback snapshot envelope", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7, "SID Volume Right": 8 },
      volumeActive: true,
      manualMuteSnapshot: { "SID 2 Muted": 1 },
      manualMuteEnablement: { sid1: true, sid2: false, sid3: true },
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });

    persistPauseMuteSnapshot(
      "device-a",
      { "SID 1 Muted": 1, "SID 3 Muted": 1 },
      { sid1: true, sid2: true, sid3: true },
    );

    expect(hydratePlaybackSnapshot("device-a")).toEqual({
      volumeSnapshot: { "SID Volume Left": 7, "SID Volume Right": 8 },
      volumeActive: true,
      manualMuteSnapshot: { "SID 2 Muted": 1 },
      manualMuteEnablement: { sid1: true, sid2: false, sid3: true },
      pauseMuteSnapshot: { "SID 1 Muted": 1, "SID 3 Muted": 1 },
      pauseMuteEnablement: { sid1: true, sid2: true, sid3: true },
    });
  });

  it("persistPauseMuteSnapshot seeds a new envelope when none exists for the device", () => {
    persistPauseMuteSnapshot("device-a", { "SID 1 Muted": 1 }, { sid1: true, sid2: false, sid3: false });

    expect(hydratePlaybackSnapshot("device-a")).toEqual({
      volumeSnapshot: {},
      volumeActive: false,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: { "SID 1 Muted": 1 },
      pauseMuteEnablement: { sid1: true, sid2: false, sid3: false },
    });
  });

  it("clearPersistedPauseMute removes only pause-mute fields from the stored envelope", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: { "SID 2 Muted": 1 },
      manualMuteEnablement: { sid1: true, sid2: false, sid3: true },
      pauseMuteSnapshot: { "SID 1 Muted": 1 },
      pauseMuteEnablement: { sid1: true, sid2: true, sid3: false },
    });

    clearPersistedPauseMute("device-a");

    expect(hydratePlaybackSnapshot("device-a")).toEqual({
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: { "SID 2 Muted": 1 },
      manualMuteEnablement: { sid1: true, sid2: false, sid3: true },
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });
  });

  it("clearPersistedPauseMute leaves the envelope untouched when no pause-mute fields are stored", () => {
    persistPlaybackSnapshot({
      deviceId: "device-a",
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: { "SID 2 Muted": 1 },
      manualMuteEnablement: { sid1: true, sid2: false, sid3: true },
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });

    clearPersistedPauseMute("device-a");

    expect(hydratePlaybackSnapshot("device-a")).toEqual({
      volumeSnapshot: { "SID Volume Left": 7 },
      volumeActive: true,
      manualMuteSnapshot: { "SID 2 Muted": 1 },
      manualMuteEnablement: { sid1: true, sid2: false, sid3: true },
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
    });
  });

  it("swallows sessionStorage write failures while persisting a playback snapshot", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() =>
      persistPlaybackSnapshot({
        deviceId: "device-a",
        volumeSnapshot: { "SID Volume Left": 7 },
        volumeActive: true,
        manualMuteSnapshot: null,
        manualMuteEnablement: null,
        pauseMuteSnapshot: null,
        pauseMuteEnablement: null,
      }),
    ).not.toThrow();

    setItemSpy.mockRestore();
  });

  it("swallows sessionStorage remove failures while discarding a matching snapshot", () => {
    sessionStorage.setItem(
      "c64u.playbackSessionSnapshot",
      JSON.stringify({
        deviceId: "device-a",
        volumeSnapshot: { "SID Volume Left": 7 },
        volumeActive: true,
      }),
    );
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("permission denied");
    });

    expect(() => discardPlaybackSnapshot("device-a")).not.toThrow();

    removeItemSpy.mockRestore();
  });
});

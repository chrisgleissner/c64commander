/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  discardPlaybackSnapshot,
  hydratePlaybackSnapshot,
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

  it("returns null when sessionStorage has no envelope", () => {
    expect(hydratePlaybackSnapshot("device-x")).toBeNull();
  });

  it("silently tolerates a corrupt envelope by returning null", () => {
    sessionStorage.setItem("c64u.playbackSessionSnapshot", "this-is-not-json");
    expect(hydratePlaybackSnapshot("device-x")).toBeNull();
  });
});

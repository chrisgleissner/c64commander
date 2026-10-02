/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  handoverForStationStart,
  isStationQueueEdited,
  lastTuneQueue,
  rememberHandover,
  resetStationHandoverSession,
  rememberedHandover,
  restoredPlaylistState,
  shouldRestorePlaylist,
  withAppendedStationItems,
  writeHandoverRecord,
  type StationHandover,
} from "@/pages/playFiles/stationPlaylistHandover";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (id: string) => ({ id, path: `/${id}.sid` }) as unknown as PlaylistItem;
const ids = (items: readonly PlaylistItem[] | null) => (items ?? []).map((entry) => entry.id);

const mine = [item("a"), item("b"), item("c")];
const stationA = [item("radio:1"), item("radio:2")];
const stationB = [item("radio:7"), item("radio:8")];

const savedFromMine = () =>
  handoverForStationStart(null, { playlist: mine, currentIndex: 1, selectedIds: new Set(["c"]) }, stationA);

beforeEach(() => {
  localStorage.clear();
  resetStationHandoverSession();
});

describe("stationPlaylistHandover", () => {
  it("saves the listener's items, order, position and selection when the first station starts", () => {
    const saved = savedFromMine();

    expect(ids(saved.items)).toEqual(["a", "b", "c"]);
    expect(saved.currentItemId).toBe("b");
    expect(saved.currentIndex).toBe(1);
    expect(saved.selectedIds).toEqual(["c"]);
    expect(saved.stationItemIds).toEqual(["radio:1", "radio:2"]);
    expect(saved.phase).toBe("station");
  });

  it("keeps the first saved playlist when a second station starts over the first one's queue", () => {
    const first = savedFromMine();

    const second = handoverForStationStart(
      first,
      { playlist: stationA, currentIndex: 0, selectedIds: new Set() },
      stationB,
    );

    expect(ids(second.items)).toEqual(["a", "b", "c"]);
    expect(second.currentItemId).toBe("b");
    expect(second.stationItemIds).toEqual(["radio:7", "radio:8"]);
  });

  it("adds the tunes queued during a stopped station's last tune to the saved playlist when a new station starts", () => {
    const finishing: StationHandover = { ...savedFromMine(), phase: "finishing", playsOutLastTune: true };
    const queue = [item("radio:2"), item("added")];

    const next = handoverForStationStart(
      finishing,
      { playlist: queue, currentIndex: 0, selectedIds: new Set() },
      stationB,
    );

    expect(ids(next.items)).toEqual(["a", "b", "c", "added"]);
    expect(next.phase).toBe("station");
    expect(next.playsOutLastTune).toBeUndefined();
  });

  it("treats the station's own refills as unedited, and an added or removed tune as an edit", () => {
    const saved = withAppendedStationItems(savedFromMine(), [item("radio:3")]);
    const queue = [...stationA, item("radio:3")];

    expect(isStationQueueEdited(queue, saved.stationItemIds)).toBe(false);
    expect(isStationQueueEdited([...queue, item("a")], saved.stationItemIds)).toBe(true);
    expect(isStationQueueEdited([stationA[0], item("radio:3")], saved.stationItemIds)).toBe(true);
  });

  it("keeps only the tune that is playing, so it ends the queue rather than being cut", () => {
    expect(ids(lastTuneQueue([...stationA, item("radio:3")], 1))).toEqual(["radio:2"]);
    expect(lastTuneQueue([], -1)).toEqual([]);
  });

  it("restores only once the station's last tune has finished or playback has stopped", () => {
    const finishing: StationHandover = { ...savedFromMine(), phase: "finishing" };
    const state = { handover: finishing, ready: true, isPlaying: true, isPaused: false, playlistEnded: false };

    expect(shouldRestorePlaylist(state)).toBe(false);
    expect(shouldRestorePlaylist({ ...state, playlistEnded: true })).toBe(true);
    expect(shouldRestorePlaylist({ ...state, isPlaying: false })).toBe(true);
    expect(shouldRestorePlaylist({ ...state, isPlaying: false, ready: false })).toBe(false);
    expect(shouldRestorePlaylist({ ...state, isPlaying: false, handover: { ...finishing, items: null } })).toBe(false);
    expect(shouldRestorePlaylist({ ...state, isPlaying: false, handover: savedFromMine() })).toBe(false);
  });

  it("gives the playlist back at once when the station's last tune is paused, as after a relaunch", () => {
    const state = {
      handover: { ...savedFromMine(), phase: "finishing" as const },
      ready: true,
      isPlaying: true,
      isPaused: true,
      playlistEnded: false,
    };

    expect(shouldRestorePlaylist(state)).toBe(true);
    expect(shouldRestorePlaylist({ ...state, isPaused: false })).toBe(false);
  });

  it("waits through a pause of a last tune left playing in this launch, but not after a relaunch", () => {
    const handover = { ...savedFromMine(), phase: "finishing" as const, playsOutLastTune: true };
    const paused = { handover, ready: true, isPlaying: true, isPaused: true, playlistEnded: false };

    expect(shouldRestorePlaylist(paused)).toBe(false);
    expect(shouldRestorePlaylist({ ...paused, isPlaying: false, isPaused: false })).toBe(true);

    writeHandoverRecord(handover);
    resetStationHandoverSession();
    const relaunched = { ...rememberedHandover()!, items: handover.items };
    expect(shouldRestorePlaylist({ ...paused, handover: relaunched })).toBe(true);
  });

  it("keeps what the listener queued while the station's last tune played, after the restored playlist", () => {
    const saved = { ...savedFromMine(), stationItemIds: ["radio:1", "radio:2"] };
    const queue = [item("radio:2"), item("added-1"), item("added-2")];

    expect(ids(restoredPlaylistState(saved, queue).playlist)).toEqual(["a", "b", "c", "added-1", "added-2"]);
  });

  it("puts the cursor back on the saved tune by id", () => {
    const saved = savedFromMine();

    const restored = restoredPlaylistState({ ...saved, items: [item("b"), item("a"), item("c")] });

    expect(restored.currentIndex).toBe(0);
    expect([...restored.selectedIds]).toEqual(["c"]);
  });

  it("finds the saved playlist again after a restart, from the persisted record alone", () => {
    writeHandoverRecord(savedFromMine());
    resetStationHandoverSession();

    const resumed = rememberedHandover();

    expect(resumed).toMatchObject({ currentItemId: "b", currentIndex: 1, selectedIds: ["c"], phase: "station" });
    expect(resumed?.items).toBeNull();
  });
});

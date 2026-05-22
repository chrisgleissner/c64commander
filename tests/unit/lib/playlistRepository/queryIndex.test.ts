import { beforeEach, describe, expect, it } from "vitest";

import {
  buildPlaylistQueryIndex,
  getPlaylistQueryIndexDiagnosticsForTests,
  queryPlaylistIndex,
  resetPlaylistQueryIndexDiagnosticsForTests,
} from "@/lib/playlistRepository/queryIndex";
import type { PlaylistItemRecord, TrackRecord } from "@/lib/playlistRepository/types";

const createdAt = "2026-05-22T00:00:00.000Z";

const buildTrack = (index: number, title: string, category = "sid"): TrackRecord => ({
  trackId: `track-${index}`,
  sourceKind: "hvsc",
  sourceLocator: "hvsc",
  category,
  title,
  path: `/HVSC/MUSICIANS/${title}-${index}.sid`,
  createdAt,
  updatedAt: createdAt,
});

const buildPlaylistItem = (index: number): PlaylistItemRecord => ({
  playlistItemId: `item-${index}`,
  playlistId: "playlist",
  trackId: `track-${index}`,
  songNr: 0,
  sortKey: String(index).padStart(6, "0"),
  status: "ready",
  addedAt: createdAt,
});

describe("playlist query index", () => {
  beforeEach(() => {
    resetPlaylistQueryIndexDiagnosticsForTests();
  });

  it("uses selective candidate ids instead of scanning the full ordered playlist for indexed text queries", () => {
    const tracks = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `track-${index}`,
        buildTrack(index, index % 2_000 === 0 ? `Needle Tune ${index}` : `Tune ${index}`),
      ]),
    );
    const playlistItems = Array.from({ length: 10_000 }, (_, index) => buildPlaylistItem(index));
    const index = buildPlaylistQueryIndex(playlistItems, tracks);

    const result = queryPlaylistIndex(index, {
      playlistId: "playlist",
      query: "needle",
      limit: 10,
      offset: 0,
      sort: "playlist-position",
    });

    expect(result.totalMatchCount).toBe(5);
    expect(result.rows.map((row) => row.playlistItem.playlistItemId)).toEqual([
      "item-0",
      "item-2000",
      "item-4000",
      "item-6000",
      "item-8000",
    ]);
    expect(getPlaylistQueryIndexDiagnosticsForTests()).toEqual({
      candidateIdsInspected: 5,
      orderedIdsInspected: 0,
    });
  });

  it("preserves deterministic sort order when iterating candidate ids", () => {
    const tracks: Record<string, TrackRecord> = {
      "track-0": buildTrack(0, "Needle Zed"),
      "track-1": buildTrack(1, "Needle Alpha"),
      "track-2": buildTrack(2, "Other"),
      "track-3": buildTrack(3, "Needle Beta"),
    };
    const playlistItems = Object.keys(tracks).map((_, index) => buildPlaylistItem(index));
    const index = buildPlaylistQueryIndex(playlistItems, tracks);

    const result = queryPlaylistIndex(index, {
      playlistId: "playlist",
      query: "needle",
      limit: 10,
      offset: 0,
      sort: "title",
    });

    expect(result.rows.map((row) => row.track.title)).toEqual(["Needle Alpha", "Needle Beta", "Needle Zed"]);
    expect(getPlaylistQueryIndexDiagnosticsForTests()).toEqual({
      candidateIdsInspected: 3,
      orderedIdsInspected: 0,
    });
  });
});

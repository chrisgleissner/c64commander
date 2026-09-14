/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeDemoTunesFromPlaylist } from "@/lib/hvsc/hvscDemoPlaylistCleanup";
import { getLocalStoragePlaylistDataRepository } from "@/lib/playlistRepository/localStorageRepository";
import type { PlaylistItemRecord, SourceKind, TrackRecord } from "@/lib/playlistRepository/types";
import { PLAYBACK_SESSION_KEY, readStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";
import { loadRecentlyPlayed, saveRecentlyPlayed, toRecentlyPlayedEntry } from "@/lib/sidRadio/recentlyPlayed";
import { SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";

/*
 * Leaving Demo Mode removes the HVSC library it installed. Before this, the playlist kept every tune
 * added from it, and the stored session resumed one on the next Play visit: the local engine could not
 * find the file, fell back to the C64, and two red toasts followed with no device connected.
 */

const now = new Date(0).toISOString();

const track = (id: string, sourceKind: SourceKind, path: string): TrackRecord => ({
  trackId: id,
  sourceKind,
  sourceLocator: path,
  sourceId: sourceKind === "hvsc" ? "hvsc-library" : null,
  title: path.split("/").pop() ?? path,
  path,
  createdAt: now,
  updatedAt: now,
});

const item = (playlistItemId: string, trackId: string, index: number): PlaylistItemRecord => ({
  playlistItemId,
  playlistId: SHARED_PLAYLIST_STORAGE_KEY,
  trackId,
  songNr: 1,
  sortKey: String(index).padStart(4, "0"),
  status: "ready",
  addedAt: now,
});

const DEMO_ITEM_ID = "hvsc:hvsc-library:/MUSICIANS/B/Barlow_Kit/Blue Screen Waltz 2.sid:2026-09-14T08:18:18.662Z";
const DEVICE_ITEM_ID =
  "ultimate:debug-c64u:/USB2/C64Music/MUSICIANS/A/Abbott_Chris/Bangkok.sid:2026-09-14T08:48:35.829Z";

const seed = async () => {
  const repository = getLocalStoragePlaylistDataRepository();
  await repository.upsertTracks([
    track("hvsc:waltz", "hvsc", "/MUSICIANS/B/Barlow_Kit/Blue Screen Waltz 2.sid"),
    track("ultimate:bangkok", "ultimate", "/USB2/C64Music/MUSICIANS/A/Abbott_Chris/Bangkok.sid"),
    track("local:tune", "local", "/Music/tune.sid"),
  ]);
  await repository.replacePlaylistItems(SHARED_PLAYLIST_STORAGE_KEY, [
    item(DEMO_ITEM_ID, "hvsc:waltz", 0),
    item(DEVICE_ITEM_ID, "ultimate:bangkok", 1),
    item("local:tune:1", "local:tune", 2),
  ]);
  return repository;
};

describe("removing the Demo Mode tunes once their library is gone", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("drops the HVSC entries from the playlist and keeps every other entry", async () => {
    const repository = await seed();

    const removed = await removeDemoTunesFromPlaylist(repository);

    expect(removed).toBe(1);
    const remaining = await repository.getPlaylistItems(SHARED_PLAYLIST_STORAGE_KEY);
    expect(remaining.map((entry) => entry.playlistItemId)).toEqual([DEVICE_ITEM_ID, "local:tune:1"]);
  });

  it("leaves the playlist untouched when it holds no HVSC tune", async () => {
    const repository = await seed();
    await removeDemoTunesFromPlaylist(repository);
    const replace = vi.spyOn(repository, "replacePlaylistItems");

    expect(await removeDemoTunesFromPlaylist(repository)).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("clears a session whose current entry was one of the removed tunes", async () => {
    const repository = await seed();
    await repository.saveSession({
      playlistId: SHARED_PLAYLIST_STORAGE_KEY,
      currentPlaylistItemId: DEMO_ITEM_ID,
      isPlaying: true,
      isPaused: false,
      elapsedMs: 12_000,
      playedMs: 12_000,
      shuffleEnabled: false,
      repeatEnabled: false,
      updatedAt: now,
    });

    await removeDemoTunesFromPlaylist(repository);

    const session = await repository.getSession(SHARED_PLAYLIST_STORAGE_KEY);
    expect(session).toEqual(expect.objectContaining({ currentPlaylistItemId: null, isPlaying: false }));
  });

  it("keeps a session whose current entry is still in the playlist", async () => {
    const repository = await seed();
    await repository.saveSession({
      playlistId: SHARED_PLAYLIST_STORAGE_KEY,
      currentPlaylistItemId: DEVICE_ITEM_ID,
      isPlaying: false,
      isPaused: false,
      elapsedMs: 0,
      playedMs: 0,
      shuffleEnabled: false,
      repeatEnabled: false,
      updatedAt: now,
    });

    await removeDemoTunesFromPlaylist(repository);

    expect((await repository.getSession(SHARED_PLAYLIST_STORAGE_KEY))?.currentPlaylistItemId).toBe(DEVICE_ITEM_ID);
  });

  it("forgets a stored playback session that would resume a removed tune", async () => {
    const repository = await seed();
    localStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
        currentItemId: DEMO_ITEM_ID,
        currentIndex: 0,
        isPlaying: true,
        isPaused: false,
        elapsedMs: 0,
        playedMs: 0,
        updatedAt: now,
      }),
    );

    await removeDemoTunesFromPlaylist(repository);

    expect(readStoredPlaybackSession()).toBeNull();
  });

  it("keeps a stored playback session for a tune that is not from the HVSC library", async () => {
    const repository = await seed();
    const stored = {
      playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
      currentItemId: DEVICE_ITEM_ID,
      currentIndex: 1,
      isPlaying: false,
      isPaused: false,
      elapsedMs: 0,
      playedMs: 0,
      updatedAt: now,
    };
    localStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify(stored));

    await removeDemoTunesFromPlaylist(repository);

    expect(readStoredPlaybackSession()).toEqual(stored);
  });

  it("removes HVSC tunes from recently played and keeps disks, programs and device tunes", async () => {
    const repository = await seed();
    saveRecentlyPlayed([
      toRecentlyPlayedEntry({ virtualPath: "/MUSICIANS/B/Barlow_Kit/Blue Screen Waltz 2.sid", title: "Waltz" }),
      toRecentlyPlayedEntry({ virtualPath: "/MUSICIANS/V/Vance_Ruth/Sprite.sid", title: "Sprite", source: "hvsc" }),
      toRecentlyPlayedEntry({
        virtualPath: "/USB2/hiltest.d64",
        title: "hiltest",
        category: "disk",
        source: "ultimate",
      }),
      toRecentlyPlayedEntry({ virtualPath: "/Games/game.prg", title: "game", category: "program", source: "local" }),
      toRecentlyPlayedEntry({ virtualPath: "/USB2/C64Music/Bangkok.sid", title: "Bangkok", source: "ultimate" }),
    ]);

    await removeDemoTunesFromPlaylist(repository);

    expect(loadRecentlyPlayed().map((entry) => entry.title)).toEqual(["hiltest", "game", "Bangkok"]);
  });
});

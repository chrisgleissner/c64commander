import { beforeEach, describe, expect, it } from 'vitest';
import { getLocalStoragePlaylistDataRepository } from '@/lib/playlistRepository';
import type { PlaylistItemRecord, PlaylistSessionRecord, TrackRecord } from '@/lib/playlistRepository';

const now = '2026-02-12T00:00:00.000Z';

const buildTrack = (overrides: Partial<TrackRecord> = {}): TrackRecord => ({
  trackId: overrides.trackId ?? 'track-1',
  sourceKind: overrides.sourceKind ?? 'local',
  sourceLocator: overrides.sourceLocator ?? '/music/demo.sid',
  category: overrides.category ?? 'song',
  title: overrides.title ?? 'Demo',
  author: overrides.author ?? null,
  released: overrides.released ?? null,
  path: overrides.path ?? '/music/demo.sid',
  sizeBytes: overrides.sizeBytes ?? null,
  modifiedAt: overrides.modifiedAt ?? null,
  defaultDurationMs: overrides.defaultDurationMs ?? 120000,
  subsongCount: overrides.subsongCount ?? 1,
  createdAt: overrides.createdAt ?? now,
  updatedAt: overrides.updatedAt ?? now,
});

const buildPlaylistItem = (overrides: Partial<PlaylistItemRecord> = {}): PlaylistItemRecord => ({
  playlistItemId: overrides.playlistItemId ?? 'item-1',
  playlistId: overrides.playlistId ?? 'playlist-default',
  trackId: overrides.trackId ?? 'track-1',
  songNr: overrides.songNr ?? 1,
  sortKey: overrides.sortKey ?? '0001',
  durationOverrideMs: overrides.durationOverrideMs ?? null,
  status: overrides.status ?? 'ready',
  unavailableReason: overrides.unavailableReason ?? null,
  addedAt: overrides.addedAt ?? now,
});

describe('localStorage playlist repository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists tracks and playlist rows and supports deterministic query paging', async () => {
    const repository = getLocalStoragePlaylistDataRepository();
    await repository.upsertTracks([
      buildTrack({ trackId: 'track-1', title: 'Alpha Demo', path: '/a/alpha.sid' }),
      buildTrack({ trackId: 'track-2', title: 'Beta Demo', path: '/b/beta.sid', sourceLocator: '/b/beta.sid' }),
      buildTrack({ trackId: 'track-3', title: 'Gamma Demo', path: '/c/gamma.sid', sourceLocator: '/c/gamma.sid' }),
    ]);

    await repository.replacePlaylistItems('playlist-default', [
      buildPlaylistItem({ playlistItemId: 'item-2', trackId: 'track-2', sortKey: '0002' }),
      buildPlaylistItem({ playlistItemId: 'item-1', trackId: 'track-1', sortKey: '0001' }),
      buildPlaylistItem({ playlistItemId: 'item-3', trackId: 'track-3', sortKey: '0003' }),
    ]);

    const page1 = await repository.queryPlaylist({
      playlistId: 'playlist-default',
      query: 'demo',
      limit: 2,
      offset: 0,
      sort: 'playlist-position',
    });
    const page2 = await repository.queryPlaylist({
      playlistId: 'playlist-default',
      query: 'demo',
      limit: 2,
      offset: 2,
      sort: 'playlist-position',
    });

    expect(page1.totalMatchCount).toBe(3);
    expect(page1.rows.map((row) => row.playlistItem.playlistItemId)).toEqual(['item-1', 'item-2']);
    expect(page2.rows.map((row) => row.playlistItem.playlistItemId)).toEqual(['item-3']);
  });

  it('applies category filter in query results', async () => {
    const repository = getLocalStoragePlaylistDataRepository();
    await repository.upsertTracks([
      buildTrack({ trackId: 'track-song', category: 'song', title: 'Song A', path: '/a/song-a.sid' }),
      buildTrack({ trackId: 'track-prg', category: 'program', title: 'Program B', path: '/b/program-b.prg', sourceLocator: '/b/program-b.prg' }),
    ]);
    await repository.replacePlaylistItems('playlist-default', [
      buildPlaylistItem({ playlistItemId: 'item-song', trackId: 'track-song', sortKey: '0001' }),
      buildPlaylistItem({ playlistItemId: 'item-prg', trackId: 'track-prg', sortKey: '0002' }),
    ]);

    const filtered = await repository.queryPlaylist({
      playlistId: 'playlist-default',
      categoryFilter: ['song'],
      limit: 50,
      offset: 0,
      sort: 'playlist-position',
    });

    expect(filtered.totalMatchCount).toBe(1);
    expect(filtered.rows.map((row) => row.playlistItem.playlistItemId)).toEqual(['item-song']);
  });

  it('returns deterministic paged results for large playlists', async () => {
    const repository = getLocalStoragePlaylistDataRepository();
    const trackCount = 2_000;
    const tracks: TrackRecord[] = [];
    const items: PlaylistItemRecord[] = [];

    for (let index = 0; index < trackCount; index += 1) {
      const id = String(index).padStart(6, '0');
      tracks.push(buildTrack({
        trackId: `track-${id}`,
        title: `Track ${id}`,
        path: `/library/track-${id}.sid`,
        sourceLocator: `/library/track-${id}.sid`,
        category: index % 2 === 0 ? 'song' : 'program',
      }));
      items.push(buildPlaylistItem({
        playlistItemId: `item-${id}`,
        trackId: `track-${id}`,
        sortKey: id,
      }));
    }

    await repository.upsertTracks(tracks);
    await repository.replacePlaylistItems('playlist-default', items);

    const result = await repository.queryPlaylist({
      playlistId: 'playlist-default',
      query: 'track 00',
      categoryFilter: ['song'],
      limit: 25,
      offset: 10,
      sort: 'playlist-position',
    });

    expect(result.totalMatchCount).toBeGreaterThan(0);
    expect(result.rows).toHaveLength(25);
    expect(result.rows[0]?.playlistItem.playlistItemId).toMatch(/^item-/);
    expect(result.rows.every((row) => row.track.category === 'song')).toBe(true);
  });

  it('stores playback session and deterministic random session cursor state', async () => {
    const repository = getLocalStoragePlaylistDataRepository();

    const playbackSession: PlaylistSessionRecord = {
      playlistId: 'playlist-default',
      currentPlaylistItemId: 'item-2',
      isPlaying: true,
      isPaused: false,
      elapsedMs: 1200,
      playedMs: 9000,
      shuffleEnabled: true,
      repeatEnabled: false,
      randomSeed: 123,
      randomCursor: 1,
      activeQuery: 'demo',
      updatedAt: now,
    };

    await repository.saveSession(playbackSession);
    expect(await repository.getSession('playlist-default')).toEqual(playbackSession);

    const random = await repository.createSession('playlist-default', ['item-1', 'item-2', 'item-3'], 777);
    expect(random.order).toHaveLength(3);
    const first = await repository.next('playlist-default');
    const second = await repository.next('playlist-default');
    const stored = await repository.getRandomSession('playlist-default');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(stored?.cursor).toBe(2);
  });
});

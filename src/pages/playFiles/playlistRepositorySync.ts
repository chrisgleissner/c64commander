import { useSyncExternalStore } from "react";
import { resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { addErrorLog, addLog } from "@/lib/logging";
import { getPlaylistDataRepository } from "@/lib/playlistRepository";
import type { PlaylistDataRepository, PlaylistItemRecord, TrackRecord } from "@/lib/playlistRepository";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import type { PlaylistItem } from "./types";

export type PlaylistRepositoryPhase =
  "IDLE" | "SCANNING" | "INGESTING" | "COMMITTING" | "BACKGROUND_COMMITTING" | "READY" | "ERROR";

export type PlaylistRepositorySyncSnapshot = {
  playlistId: string;
  phase: PlaylistRepositoryPhase;
  revision: number;
  expectedCount: number;
  committedCount: number;
  snapshotKey: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

type PlaylistCommitResult = {
  committedCount: number;
  expectedCount: number;
  revision: number;
  snapshotKey: string;
};

type PlaylistCommitRequest = {
  playlistId: string;
  items: PlaylistItem[];
  repository?: PlaylistDataRepository;
  trackChunkSize?: number;
  initialPhase?: "COMMITTING" | "BACKGROUND_COMMITTING";
};

type SerializedPlaylistRepository = {
  tracks: TrackRecord[];
  playlistItems: PlaylistItemRecord[];
};

const SNAPSHOT_KEY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const defaultSnapshot = (playlistId: string): PlaylistRepositorySyncSnapshot => ({
  playlistId,
  phase: "IDLE",
  revision: 0,
  expectedCount: 0,
  committedCount: 0,
  snapshotKey: null,
  lastError: null,
  updatedAt: null,
});

const ensureSnapshot = (playlistId: string) => {
  const existing = snapshots.get(playlistId);
  if (existing) return existing;
  const created = defaultSnapshot(playlistId);
  snapshots.set(playlistId, created);
  return created;
};

const snapshots = new Map<string, PlaylistRepositorySyncSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const inflightCommits = new Map<string, { snapshotKey: string; promise: Promise<PlaylistCommitResult> }>();
// Serializes actual repository writes per playlistId so a stale (earlier
// requested) commit can never finish after and overwrite a fresher one that
// was requested later. inflightCommits only dedupes identical snapshotKeys;
// this chain covers the general case of two different snapshots requested in
// quick succession. See HARD9-034.
const commitChainTails = new Map<string, Promise<unknown>>();

const buildTrackId = (
  source: string,
  sourceId: string | null | undefined,
  path: string,
  originDeviceId?: string | null,
) => `${source}:${sourceId ?? originDeviceId ?? ""}:${normalizeSourcePath(path)}`;

const buildSnapshotKey = (serialized: SerializedPlaylistRepository) => {
  let hash = 2166136261;
  const write = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    // Unit separator prevents adjacent-field collisions such as "a"+"bc" vs "ab"+"c".
    hash ^= 0x1f;
    hash = Math.imul(hash, 16777619);
  };
  const writeNullable = (value: string | number | null | undefined) => {
    write(value === null ? "<null>" : value === undefined ? "<undefined>" : String(value));
  };
  const writeJson = (value: unknown) => {
    write(JSON.stringify(value) ?? "<undefined>");
  };

  writeNullable(serialized.tracks.length);
  serialized.tracks.forEach((track) => {
    writeNullable(track.trackId);
    writeNullable(track.sourceKind);
    writeNullable(track.sourceLocator);
    writeNullable(track.sourceId);
    writeJson(track.origin ?? null);
    writeNullable(track.category);
    writeNullable(track.title);
    writeNullable(track.author);
    writeNullable(track.released);
    writeNullable(track.path);
    writeJson(track.configRef ?? null);
    writeJson(track.archiveRef ?? null);
    writeNullable(track.sizeBytes);
    writeNullable(track.modifiedAt);
    writeNullable(track.defaultDurationMs);
    writeNullable(track.subsongCount);
    writeNullable(track.createdAt);
    writeNullable(track.updatedAt);
  });

  writeNullable(serialized.playlistItems.length);
  serialized.playlistItems.forEach((playlistItem) => {
    writeNullable(playlistItem.playlistItemId);
    writeNullable(playlistItem.playlistId);
    writeNullable(playlistItem.trackId);
    writeJson(playlistItem.configRef ?? null);
    writeNullable(playlistItem.configOrigin);
    writeJson(playlistItem.configOverrides ?? null);
    writeNullable(playlistItem.songNr);
    writeNullable(playlistItem.sortKey);
    writeNullable(playlistItem.durationOverrideMs);
    writeNullable(playlistItem.status);
    writeNullable(playlistItem.unavailableReason);
    writeNullable(playlistItem.addedAt);
  });
  return `${serialized.playlistItems.length}:${hash >>> 0}`;
};

const getSnapshot = (playlistId: string) => ensureSnapshot(playlistId);

const emitSnapshot = (playlistId: string, next: Partial<PlaylistRepositorySyncSnapshot>) => {
  const current = getSnapshot(playlistId);
  const merged: PlaylistRepositorySyncSnapshot = {
    ...current,
    ...next,
    playlistId,
    updatedAt: new Date().toISOString(),
  };
  snapshots.set(playlistId, merged);
  listeners.get(playlistId)?.forEach((listener) => listener());
  return merged;
};

export const markPlaylistRepositoryPhase = (
  playlistId: string,
  phase: PlaylistRepositoryPhase,
  extras: Partial<PlaylistRepositorySyncSnapshot> = {},
) => {
  addLog("info", "Playlist repository phase transition", {
    playlistId,
    phase,
    ...extras,
  });
  return emitSnapshot(playlistId, { phase, ...extras });
};

export const usePlaylistRepositorySyncSnapshot = (playlistId: string) =>
  useSyncExternalStore(
    (listener) => {
      const current = listeners.get(playlistId) ?? new Set<() => void>();
      current.add(listener);
      listeners.set(playlistId, current);
      return () => {
        const existing = listeners.get(playlistId);
        if (!existing) return;
        existing.delete(listener);
        if (existing.size === 0) {
          listeners.delete(playlistId);
        }
      };
    },
    () => getSnapshot(playlistId),
    () => getSnapshot(playlistId),
  );

export const serializePlaylistToRepository = (
  items: PlaylistItem[],
  playlistId: string,
  nowIso = new Date().toISOString(),
): SerializedPlaylistRepository => {
  const tracksById = new Map<string, TrackRecord>();
  const playlistItems: PlaylistItemRecord[] = items.map((item, index) => ({
    playlistItemId: item.id,
    playlistId,
    trackId: buildTrackId(item.request.source, item.sourceId ?? null, item.path, item.origin?.originDeviceId ?? null),
    configRef: item.configRef ?? null,
    configOrigin: item.configOrigin ?? resolveStoredConfigOrigin(item.configRef ?? null, null),
    configOverrides: item.configOverrides ?? null,
    songNr: item.request.songNr ?? 1,
    sortKey: String(index).padStart(8, "0"),
    durationOverrideMs: item.durationMs ?? null,
    status: item.status ?? "ready",
    unavailableReason: item.unavailableReason ?? null,
    addedAt: item.addedAt ?? nowIso,
  }));
  items.forEach((item) => {
    const trackId = buildTrackId(
      item.request.source,
      item.sourceId ?? null,
      item.path,
      item.origin?.originDeviceId ?? null,
    );
    tracksById.set(trackId, {
      trackId,
      sourceKind: item.request.source,
      sourceLocator: normalizeSourcePath(item.path),
      sourceId: item.sourceId ?? null,
      origin: item.origin ?? null,
      category: item.category,
      title: item.label,
      author: null,
      released: null,
      path: normalizeSourcePath(item.path),
      archiveRef: item.archiveRef ?? null,
      sizeBytes: item.sizeBytes ?? null,
      modifiedAt: item.modifiedAt ?? null,
      defaultDurationMs: item.durationMs ?? null,
      durationSource: item.durationSource ?? null,
      subsongCount: item.subsongCount ?? null,
      createdAt: item.addedAt ?? nowIso,
      updatedAt: nowIso,
      configRef: item.configRef ?? null,
    });
  });
  return { tracks: Array.from(tracksById.values()), playlistItems };
};

const withPersistenceTimestamp = (
  serialized: SerializedPlaylistRepository,
  nowIso: string,
): SerializedPlaylistRepository => ({
  tracks: serialized.tracks.map((track) => ({
    ...track,
    createdAt: track.createdAt === SNAPSHOT_KEY_TIMESTAMP ? nowIso : track.createdAt,
    updatedAt: nowIso,
  })),
  playlistItems: serialized.playlistItems.map((playlistItem) => ({
    ...playlistItem,
    addedAt: playlistItem.addedAt === SNAPSHOT_KEY_TIMESTAMP ? nowIso : playlistItem.addedAt,
  })),
});

const persistSerializedPlaylist = async (
  repository: PlaylistDataRepository,
  playlistId: string,
  serialized: SerializedPlaylistRepository,
  trackChunkSize: number,
) => {
  if (typeof repository.replacePlaylistSnapshot === "function") {
    const commitT0 = Date.now();
    await repository.replacePlaylistSnapshot(playlistId, serialized);
    addLog("debug", "[hvsc-perf] replacePlaylistSnapshot done", {
      tracks: serialized.tracks.length,
      items: serialized.playlistItems.length,
      ms: Date.now() - commitT0,
    });
    return;
  }
  const utT0 = Date.now();
  for (let index = 0; index < serialized.tracks.length; index += trackChunkSize) {
    await repository.upsertTracks(serialized.tracks.slice(index, index + trackChunkSize));
  }
  addLog("debug", "[hvsc-perf] upsertTracks done", {
    chunks: Math.ceil(serialized.tracks.length / trackChunkSize),
    ms: Date.now() - utT0,
  });
  const rpT0 = Date.now();
  await repository.replacePlaylistItems(playlistId, serialized.playlistItems);
  addLog("debug", "[hvsc-perf] replacePlaylistItems done", {
    count: serialized.playlistItems.length,
    ms: Date.now() - rpT0,
  });
};

export const commitPlaylistSnapshot = async ({
  playlistId,
  items,
  repository = getPlaylistDataRepository(),
  trackChunkSize = 500,
  initialPhase = "COMMITTING",
}: PlaylistCommitRequest): Promise<PlaylistCommitResult> => {
  const canonicalSerialized = serializePlaylistToRepository(items, playlistId, SNAPSHOT_KEY_TIMESTAMP);
  const snapshotKey = buildSnapshotKey(canonicalSerialized);
  const current = getSnapshot(playlistId);
  if (current.phase === "READY" && current.snapshotKey === snapshotKey && current.committedCount === items.length) {
    return {
      committedCount: current.committedCount,
      expectedCount: current.expectedCount,
      revision: current.revision,
      snapshotKey,
    };
  }

  const inflight = inflightCommits.get(playlistId);
  if (inflight?.snapshotKey === snapshotKey) {
    return inflight.promise;
  }

  const expectedCount = items.length;
  emitSnapshot(playlistId, {
    phase: initialPhase,
    expectedCount,
    lastError: null,
  });

  const scope = beginHvscPerfScope("playlist:repo-sync", {
    playlistId,
    expectedCount,
    trackChunkSize,
  });

  addLog("info", "Playlist repository commit started", {
    playlistId,
    expectedCount,
    snapshotKey,
  });

  // Chain the actual write onto the tail of any prior commit for this
  // playlistId, regardless of snapshotKey, so writes execute strictly in
  // request order. A prior failure must not break the chain for this request.
  const previousTail = commitChainTails.get(playlistId) ?? Promise.resolve();
  const promise = previousTail
    .catch(() => undefined)
    .then(() =>
      (async () => {
        const serT0 = Date.now();
        const serialized = withPersistenceTimestamp(canonicalSerialized, new Date().toISOString());
        addLog("debug", "[hvsc-perf] serialize done", {
          tracks: serialized.tracks.length,
          items: serialized.playlistItems.length,
          ms: Date.now() - serT0,
        });
        const persT0 = Date.now();
        await persistSerializedPlaylist(repository, playlistId, serialized, trackChunkSize);
        addLog("debug", "[hvsc-perf] persist done", { ms: Date.now() - persT0 });
        const valT0 = Date.now();
        const committedCount = await repository.getPlaylistItemCount(playlistId);
        addLog("debug", "[hvsc-perf] validate done", {
          committed: committedCount,
          ms: Date.now() - valT0,
        });
        if (committedCount !== expectedCount) {
          throw new Error(
            `Playlist repository validation failed for ${playlistId}: expected ${expectedCount}, got ${committedCount}`,
          );
        }

        const nextRevision = getSnapshot(playlistId).revision + 1;
        emitSnapshot(playlistId, {
          phase: "READY",
          committedCount,
          expectedCount,
          revision: nextRevision,
          snapshotKey,
          lastError: null,
        });
        addLog("info", "Playlist repository commit ready", {
          playlistId,
          expectedCount,
          committedCount,
          revision: nextRevision,
          snapshotKey,
        });
        endHvscPerfScope(scope, {
          outcome: "success",
          playlistId,
          expectedCount,
          committedCount,
          revision: nextRevision,
        });
        return {
          committedCount,
          expectedCount,
          revision: nextRevision,
          snapshotKey,
        };
      })(),
    )
    .catch((error) => {
      const err = error as Error;
      emitSnapshot(playlistId, {
        phase: "ERROR",
        expectedCount,
        lastError: err.message,
      });
      addErrorLog("Playlist repository commit failed", {
        playlistId,
        expectedCount,
        snapshotKey,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
      endHvscPerfScope(scope, {
        outcome: "error",
        playlistId,
        expectedCount,
        errorName: err.name,
        errorMessage: err.message,
      });
      throw error;
    })
    .finally(() => {
      const active = inflightCommits.get(playlistId);
      if (active?.snapshotKey === snapshotKey) {
        inflightCommits.delete(playlistId);
      }
    });

  commitChainTails.set(playlistId, promise.catch(() => undefined));
  inflightCommits.set(playlistId, {
    snapshotKey,
    promise,
  });

  return promise;
};

export const resetPlaylistRepositorySyncForTests = () => {
  snapshots.clear();
  listeners.clear();
  inflightCommits.clear();
  commitChainTails.clear();
};

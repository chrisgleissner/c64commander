import { useSyncExternalStore } from "react";
import { resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { addErrorLog, addLog } from "@/lib/logging";
import { getPlaylistDataRepository } from "@/lib/playlistRepository";
import type { PlaylistDataRepository, PlaylistItemRecord, TrackRecord } from "@/lib/playlistRepository";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import type { PlaylistItem } from "./types";

export type PlaylistRepositoryPhase =
  | "IDLE"
  | "SCANNING"
  | "INGESTING"
  | "COMMITTING"
  | "BACKGROUND_COMMITTING"
  | "READY"
  | "ERROR";

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

const buildTrackId = (source: string, sourceId: string | null | undefined, path: string) =>
  `${source}:${sourceId ?? ""}:${normalizeSourcePath(path)}`;

const buildSnapshotKey = (playlistId: string, items: PlaylistItem[]) => {
  let hash = 2166136261;
  const write = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };

  write(playlistId);
  write(String(items.length));
  items.forEach((item, index) => {
    write(item.id);
    write(item.path);
    write(item.request.source);
    write(String(item.request.songNr ?? 1));
    write(item.status ?? "ready");
    write(item.addedAt ?? "");
    write(String(index));
  });

  return `${items.length}:${hash >>> 0}`;
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

export const serializePlaylistToRepository = (items: PlaylistItem[], playlistId: string) => {
  const nowIso = new Date().toISOString();
  const tracks: TrackRecord[] = items.map((item) => ({
    trackId: buildTrackId(item.request.source, item.sourceId ?? null, item.path),
    sourceKind: item.request.source,
    sourceLocator: normalizeSourcePath(item.path),
    sourceId: item.sourceId ?? null,
    category: item.category,
    title: item.label,
    author: null,
    released: null,
    path: normalizeSourcePath(item.path),
    archiveRef: item.archiveRef ?? null,
    sizeBytes: item.sizeBytes ?? null,
    modifiedAt: item.modifiedAt ?? null,
    defaultDurationMs: item.durationMs ?? null,
    subsongCount: item.subsongCount ?? null,
    createdAt: item.addedAt ?? nowIso,
    updatedAt: nowIso,
    configRef: item.configRef ?? null,
  }));
  const playlistItems: PlaylistItemRecord[] = items.map((item, index) => ({
    playlistItemId: item.id,
    playlistId,
    trackId: buildTrackId(item.request.source, item.sourceId ?? null, item.path),
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
  return { tracks, playlistItems };
};

const persistSerializedPlaylist = async (
  repository: PlaylistDataRepository,
  playlistId: string,
  serialized: { tracks: TrackRecord[]; playlistItems: PlaylistItemRecord[] },
  trackChunkSize: number,
) => {
  const utT0 = Date.now();
  for (let index = 0; index < serialized.tracks.length; index += trackChunkSize) {
    await repository.upsertTracks(serialized.tracks.slice(index, index + trackChunkSize));
  }
  console.info(
    `[hvsc-perf] upsertTracks done chunks=${Math.ceil(serialized.tracks.length / trackChunkSize)} ms=${Date.now() - utT0}`,
  );
  const rpT0 = Date.now();
  await repository.replacePlaylistItems(playlistId, serialized.playlistItems);
  console.info(
    `[hvsc-perf] replacePlaylistItems done count=${serialized.playlistItems.length} ms=${Date.now() - rpT0}`,
  );
};

export const commitPlaylistSnapshot = async ({
  playlistId,
  items,
  repository = getPlaylistDataRepository(),
  trackChunkSize = 500,
  initialPhase = "COMMITTING",
}: PlaylistCommitRequest): Promise<PlaylistCommitResult> => {
  const snapshotKey = buildSnapshotKey(playlistId, items);
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

  const promise = (async () => {
    const serT0 = Date.now();
    const serialized = serializePlaylistToRepository(items, playlistId);
    console.info(
      `[hvsc-perf] serialize done tracks=${serialized.tracks.length} items=${serialized.playlistItems.length} ms=${Date.now() - serT0}`,
    );
    const persT0 = Date.now();
    await persistSerializedPlaylist(repository, playlistId, serialized, trackChunkSize);
    console.info(`[hvsc-perf] persist done ms=${Date.now() - persT0}`);
    const valT0 = Date.now();
    const committedCount = await repository.getPlaylistItemCount(playlistId);
    console.info(`[hvsc-perf] validate done committed=${committedCount} ms=${Date.now() - valT0}`);
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
  })()
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
};

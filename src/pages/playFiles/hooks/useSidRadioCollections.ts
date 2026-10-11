/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";

import { isStilCollectionId, type StilCollectionId } from "@/lib/hvsc";
import { addLog } from "@/lib/logging";
import {
  loadCollectionPool,
  loadCollectionSizes,
  prepareCollectionNotes,
  type CollectionNotesStatus,
} from "@/lib/sidRadio/collectionPool";
import type { StationSeed } from "@/lib/sidRadio/stationEngine";
import type { StationRefillResult } from "@/lib/sidRadio/stationQueueProvider";
import type { SidRadioNotice } from "@/pages/playFiles/sidRadioNotices";

/** The state SID Radio keeps for collection stations, apart from the station itself. */

const NOTES_REFUSAL: Record<Exclude<CollectionNotesStatus, "ready">, SidRadioNotice> = {
  "no-library": "no-hvsc",
  "demo-library": "no-radio-for-collection",
  "not-downloaded": "collection-notes-unavailable",
};

/** How far through its members a collection station is; tunes still queued ahead are not heard yet. */
export const collectionProgressOf = (
  size: number | null,
  consumed: number,
  queuedAhead: number,
): { heard: number; total: number } | null =>
  size === null ? null : { heard: Math.min(size, Math.max(0, consumed - queuedAhead)), total: size };

/**
 * What to tell the listener when a collection station's refill produced nothing, or null for now.
 *
 * "Every tune heard" waits for the last queued tune: the refill that finds the pool empty runs while
 * several tunes are still ahead of the cursor.
 */
export const collectionEndNotice = (
  reason: NonNullable<StationRefillResult["reason"]>,
  notesMissing: boolean,
  queuedAhead: number,
): SidRadioNotice | null => {
  if (reason !== "exhausted") return notesMissing ? "collection-notes-unavailable" : "no-radio-for-collection";
  return queuedAhead === 0 ? "collection-ended" : null;
};

const sameCounts = (a: Record<StilCollectionId, number>, b: Record<StilCollectionId, number>) =>
  Object.keys(b).length === Object.keys(a).length &&
  Object.keys(b).every((id) => a[id as StilCollectionId] === b[id as StilCollectionId]);

export const useSidRadioCollections = (params: { enabled: boolean; ensureResolvable?: () => Promise<unknown> }) => {
  const { enabled, ensureResolvable } = params;
  const [collectionCounts, setCollectionCounts] = useState<Record<StilCollectionId, number> | null>(null);
  const [collectionSize, setCollectionSize] = useState<number | null>(null);
  const [preparingRequest, setPreparingRequest] = useState<number | null>(null);
  /** Set by a refill whose collection had no STIL to read, so the notice can name the real cause. */
  const notesMissingRef = useRef(false);

  // Paths resolve only once the songlengths index is loaded, and both the counts and a resumed
  // station's size are counted in resolved members.
  const awaitResolvable = useCallback(
    async (purpose: string) => {
      try {
        await ensureResolvable?.();
      } catch (error) {
        addLog("warn", "SID Radio: path index was not ready for the collections", {
          service: "sid-radio",
          purpose,
          error: (error as Error)?.message ?? String(error),
        });
      }
    },
    [ensureResolvable],
  );

  const ensureCollectionCounts = useCallback(async () => {
    if (!enabled) return;
    await awaitResolvable("counts");
    const sizes = await loadCollectionSizes();
    if (!sizes) return;
    setCollectionCounts((previous) => (previous && sameCounts(previous, sizes) ? previous : sizes));
  }, [enabled, awaitResolvable]);

  /**
   * Make STIL available for the start identified by `request`; returns the refusal, or null when ready.
   * The wait is shown only while `request` is still the latest start.
   */
  const prepareNotes = useCallback(
    async (request: number, isCurrent: () => boolean): Promise<SidRadioNotice | null> => {
      try {
        const status = await prepareCollectionNotes(() => {
          if (isCurrent()) setPreparingRequest(request);
        });
        return status === "ready" ? null : NOTES_REFUSAL[status];
      } finally {
        setPreparingRequest((current) => (current === request ? null : current));
      }
    },
    [],
  );

  /** A stop or a newer start abandons the wait, even though its download runs on. */
  const abandonPreparing = useCallback(() => setPreparingRequest(null), []);

  /** A station resumed after a restart has not refilled yet, so its size is read here. */
  const restoreCollectionSize = useCallback(
    (seed: StationSeed, isCurrent: () => boolean) => {
      const id = seed.collectionId;
      if (seed.kind !== "collection" || !isStilCollectionId(id)) return;
      void (async () => {
        await awaitResolvable("resume");
        const pool = await loadCollectionPool(id);
        if (pool && isCurrent()) setCollectionSize(pool.md5_48.length);
      })().catch((error: unknown) =>
        addLog("warn", "SID Radio: could not read the size of a resumed collection", {
          service: "sid-radio",
          collection: id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    },
    [awaitResolvable],
  );

  return {
    collectionCounts,
    ensureCollectionCounts,
    collectionSize,
    setCollectionSize,
    preparingCollection: preparingRequest !== null,
    prepareNotes,
    abandonPreparing,
    restoreCollectionSize,
    notesMissingRef,
  };
};

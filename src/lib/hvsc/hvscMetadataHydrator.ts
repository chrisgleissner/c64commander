import { addLog } from "@/lib/logging";
import { base64ToUint8, buildSidTrackSubsongs, parseSidHeaderMetadata } from "@/lib/sid/sidUtils";

import { updateHvscBrowseSong, type HvscBrowseIndexSnapshot } from "./hvscBrowseIndexStore";
import type { HvscProgressEvent, HvscSong } from "./hvscTypes";

const HYDRATION_CHUNK_SIZE = 8;
const yieldToUi = async () => {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
};

const buildMetadataMessage = (
  processedCount: number,
  totalCount: number,
  statusToken: NonNullable<HvscProgressEvent["statusToken"]>,
) => `HVSC META ${processedCount.toLocaleString()}/${totalCount.toLocaleString()} ${statusToken}`;

const canHydrateSong = (metadataStatus?: string | null) => metadataStatus !== "hydrated" && metadataStatus !== "error";

export type HydrateHvscMetadataOptions = {
  snapshot: HvscBrowseIndexSnapshot;
  readSong: (virtualPath: string) => Promise<HvscSong | null>;
  emitProgress: (event: Omit<HvscProgressEvent, "ingestionId" | "elapsedTimeMs">) => void;
  onSnapshotUpdated?: (snapshot: HvscBrowseIndexSnapshot) => Promise<void> | void;
};

export const hydrateHvscMetadata = async ({
  snapshot,
  readSong,
  emitProgress,
  onSnapshotUpdated,
}: HydrateHvscMetadataOptions) => {
  const candidatePaths = Object.values(snapshot.songs)
    .filter((song) => canHydrateSong(song.metadataStatus))
    .map((song) => song.virtualPath)
    .sort((left, right) => left.localeCompare(right));
  const totalCount = candidatePaths.length;

  emitProgress({
    stage: "sid_metadata_hydration",
    statusToken: totalCount > 0 ? "queued" : "done",
    message: buildMetadataMessage(0, totalCount, totalCount > 0 ? "queued" : "done"),
    processedCount: 0,
    totalCount,
    percent: totalCount > 0 ? 0 : 100,
    failedSongs: 0,
  });

  if (totalCount === 0) {
    return snapshot;
  }

  let processedCount = 0;
  let failedSongs = 0;

  for (let index = 0; index < candidatePaths.length; index += HYDRATION_CHUNK_SIZE) {
    const chunk = candidatePaths.slice(index, index + HYDRATION_CHUNK_SIZE);

    chunk.forEach((virtualPath) => {
      updateHvscBrowseSong(snapshot, virtualPath, {
        metadataStatus: "hydrating",
      });
    });

    for (const virtualPath of chunk) {
      try {
        const detail = await readSong(virtualPath);
        if (!detail?.dataBase64) {
          failedSongs += 1;
          updateHvscBrowseSong(snapshot, virtualPath, {
            metadataStatus: "error",
          });
          continue;
        }

        const sidMetadata = parseSidHeaderMetadata(base64ToUint8(detail.dataBase64));
        updateHvscBrowseSong(snapshot, virtualPath, {
          canonicalTitle: sidMetadata.name || null,
          canonicalAuthor: sidMetadata.author || null,
          released: sidMetadata.released || null,
          defaultSong: sidMetadata.startSong,
          metadataStatus: "hydrated",
          sidMetadata,
          trackSubsongs: buildSidTrackSubsongs(sidMetadata.songs, sidMetadata.startSong),
          subsongCount: sidMetadata.songs,
        });
      } catch (error) {
        failedSongs += 1;
        updateHvscBrowseSong(snapshot, virtualPath, {
          metadataStatus: "error",
        });
        addLog("warn", "HVSC metadata hydration failed for song", {
          virtualPath,
          error: (error as Error).message,
        });
      } finally {
        processedCount += 1;
      }
    }

    await onSnapshotUpdated?.(snapshot);

    const statusToken = processedCount >= totalCount ? "done" : "running";
    emitProgress({
      stage: "sid_metadata_hydration",
      statusToken,
      message: buildMetadataMessage(processedCount, totalCount, statusToken),
      currentFile: chunk[chunk.length - 1] ?? null,
      processedCount,
      totalCount,
      percent: Math.round((processedCount / totalCount) * 100),
      failedSongs,
    });

    await yieldToUi();
  }

  if (failedSongs > 0) {
    addLog("warn", "HVSC metadata hydration completed with failures", {
      processedCount,
      totalCount,
      failedSongs,
    });
  }

  return snapshot;
};

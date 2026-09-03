/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from "@capacitor/core";
import { getActiveAction } from "@/lib/tracing/actionTrace";
import { resolveNativeTraceContext, type NativeTraceContext } from "@/lib/native/nativeTraceContext";

export type HvscNativeIngestResult = {
  totalEntries: number;
  songsIngested: number;
  songsDeleted: number;
  // HARD18-028: the actual deleted virtual paths - songsDeleted alone is a
  // count and can't drive removing the stale songs from the JS browse index.
  deletedVirtualPaths: string[];
  failedSongs: number;
  failedPaths: string[];
  songlengthFilesWritten: number;
  metadataRows: number;
  metadataUpserts: number;
  metadataDeletes: number;
  archiveBytes: number;
};

export type HvscNativeDownloadResult = {
  totalBytes: number;
  resumedFromBytes: number;
  transferredBytes: number;
};

export type HvscNativeDownloadProgressEvent = {
  relativeArchivePath: string;
  downloadedBytes: number;
  totalBytes: number;
  percent?: number;
};

export type HvscNativeProgressEvent = {
  stage: string;
  message: string;
  processedCount?: number;
  totalCount?: number;
  percent?: number;
  currentFile?: string;
  songsUpserted?: number;
  songsDeleted?: number;
};

type HvscIngestionPlugin = {
  ingestHvsc: (options: {
    relativeArchivePath: string;
    mode: "baseline" | "update";
    resetLibrary?: boolean;
    dbBatchSize?: number;
    minExpectedRows?: number;
    progressEvery?: number;
    debugHeapLogging?: boolean;
    traceContext?: NativeTraceContext;
  }) => Promise<HvscNativeIngestResult>;
  cancelIngestion: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
  getIngestionStats: (options?: { traceContext?: NativeTraceContext }) => Promise<{ metadataRows: number }>;
  getStorageBudget: (options?: {
    traceContext?: NativeTraceContext;
  }) => Promise<{ availableBytes: number; libraryPresent: boolean }>;
  readArchiveChunk: (options: {
    relativeArchivePath: string;
    offsetBytes: number;
    lengthBytes: number;
    traceContext?: NativeTraceContext;
  }) => Promise<{ data: string; sizeBytes: number; eof: boolean }>;
  // Only Android implements this; iOS and the web reject it as unimplemented and the caller
  // falls back to the whole-file download. See HARD27-028.
  downloadArchive: (options: {
    relativeArchivePath: string;
    url: string;
    expectedTotalBytes?: number;
    traceContext?: NativeTraceContext;
  }) => Promise<HvscNativeDownloadResult>;
  addListener: {
    (
      eventName: "hvscProgress",
      listenerFunc: (event: HvscNativeProgressEvent) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    (
      eventName: "hvscDownloadProgress",
      listenerFunc: (event: HvscNativeDownloadProgressEvent) => void,
    ): Promise<{ remove: () => Promise<void> }>;
  };
};

const plugin = registerPlugin<HvscIngestionPlugin>("HvscIngestion");

export const HvscIngestion = {
  ingestHvsc: (options: {
    relativeArchivePath: string;
    mode: "baseline" | "update";
    resetLibrary?: boolean;
    dbBatchSize?: number;
    minExpectedRows?: number;
    progressEvery?: number;
    debugHeapLogging?: boolean;
  }) =>
    plugin.ingestHvsc({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  cancelIngestion: () =>
    plugin.cancelIngestion({
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  getIngestionStats: () =>
    plugin.getIngestionStats({
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  getStorageBudget: () =>
    plugin.getStorageBudget({
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  readArchiveChunk: (options: { relativeArchivePath: string; offsetBytes: number; lengthBytes: number }) =>
    plugin.readArchiveChunk({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  downloadArchive: (options: { relativeArchivePath: string; url: string; expectedTotalBytes?: number }) =>
    plugin.downloadArchive({
      ...options,
      traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
  addProgressListener: (listener: (event: HvscNativeProgressEvent) => void) =>
    plugin.addListener("hvscProgress", listener),
  addDownloadProgressListener: (listener: (event: HvscNativeDownloadProgressEvent) => void) =>
    plugin.addListener("hvscDownloadProgress", listener),
};

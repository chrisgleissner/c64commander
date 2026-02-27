/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';
import { getActiveAction } from '@/lib/tracing/actionTrace';
import { resolveNativeTraceContext, type NativeTraceContext } from '@/lib/native/nativeTraceContext';

export type HvscNativeIngestResult = {
    totalEntries: number;
    songsIngested: number;
    songsDeleted: number;
    failedSongs: number;
    failedPaths: string[];
    songlengthFilesWritten: number;
    metadataRows: number;
    metadataUpserts: number;
    metadataDeletes: number;
    archiveBytes: number;
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
        mode: 'baseline' | 'update';
        resetLibrary?: boolean;
        dbBatchSize?: number;
        minExpectedRows?: number;
        progressEvery?: number;
        debugHeapLogging?: boolean;
        traceContext?: NativeTraceContext;
    }) => Promise<HvscNativeIngestResult>;
    cancelIngestion: (options?: { traceContext?: NativeTraceContext }) => Promise<void>;
    getIngestionStats: (options?: { traceContext?: NativeTraceContext }) => Promise<{ metadataRows: number }>;
    addListener: (
        eventName: 'hvscProgress',
        listenerFunc: (event: HvscNativeProgressEvent) => void,
    ) => Promise<{ remove: () => Promise<void> }>;
};

const plugin = registerPlugin<HvscIngestionPlugin>('HvscIngestion');

export const HvscIngestion = {
    ingestHvsc: (options: {
        relativeArchivePath: string;
        mode: 'baseline' | 'update';
        resetLibrary?: boolean;
        dbBatchSize?: number;
        minExpectedRows?: number;
        progressEvery?: number;
        debugHeapLogging?: boolean;
    }) => plugin.ingestHvsc({
        ...options,
        traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
    cancelIngestion: () => plugin.cancelIngestion({
        traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
    getIngestionStats: () => plugin.getIngestionStats({
        traceContext: resolveNativeTraceContext(getActiveAction()),
    }),
    addProgressListener: (listener: (event: HvscNativeProgressEvent) => void) =>
        plugin.addListener('hvscProgress', listener),
};

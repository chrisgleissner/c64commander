/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
    FtpCommandEntry,
    FtpDataEntry,
    FtpResponseEntry,
    RestRequestEntry,
    RestResponseEntry,
    TraceEntry,
    TraceEntryBase,
    TraceTestType,
} from "./traceSchema.js";

type EmittableTraceEntry =
    | Omit<RestRequestEntry, "globalSeq" | "runSessionId" | "stageId" | "testType">
    | Omit<RestResponseEntry, "globalSeq" | "runSessionId" | "stageId" | "testType">
    | Omit<FtpCommandEntry, "globalSeq" | "runSessionId" | "stageId" | "testType">
    | Omit<FtpResponseEntry, "globalSeq" | "runSessionId" | "stageId" | "testType">
    | Omit<FtpDataEntry, "globalSeq" | "runSessionId" | "stageId" | "testType">;

export class TraceCollector {
    private seq = 0;
    private entries: TraceEntry[] = [];
    private streamCallback?: (entry: TraceEntry) => void;
    private currentStageId?: string;
    private currentTestType?: TraceTestType;
    readonly runSessionId: string;

    constructor(runSessionId: string) {
        this.runSessionId = runSessionId;
    }

    onEmit(cb: (entry: TraceEntry) => void): void {
        this.streamCallback = cb;
    }

    setStageContext(stageId: string | undefined, testType: TraceTestType | undefined): void {
        this.currentStageId = stageId;
        this.currentTestType = testType;
    }

    stageContext(): Pick<TraceEntryBase, "stageId" | "testType"> {
        return { stageId: this.currentStageId, testType: this.currentTestType };
    }

    emit(partial: EmittableTraceEntry): void {
        try {
            this.seq += 1;
            const entry = {
                ...partial,
                globalSeq: this.seq,
                runSessionId: this.runSessionId,
                ...this.stageContext(),
            } as TraceEntry;
            this.entries.push(entry);
            this.streamCallback?.(entry);
        } catch (error) {
            console.warn("TraceCollector.emit failed", { error: String(error) });
        }
    }

    snapshot(): TraceEntry[] {
        return [...this.entries];
    }
}

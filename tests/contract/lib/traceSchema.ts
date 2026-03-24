/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { serializeTraceValue } from "./traceSerialization.js";

export type TraceTestType = "soak" | "stress" | "spike";
export type RunOutcome = "completed" | "device-unresponsive";

export type TraceEntryBase = {
    globalSeq: number;
    runSessionId: string;
    correlationId: string;
    parentCorrelationId?: string;
    clientId: string;
    stageId?: string;
    testType?: TraceTestType;
    timestamp: string;
    launchedAtMs: number;
    hrTimeNs: bigint;
};

export type RestRequestEntry = TraceEntryBase & {
    protocol: "REST";
    direction: "request";
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
};

export type RestResponseEntry = TraceEntryBase & {
    protocol: "REST";
    direction: "response";
    status: number;
    headers: Record<string, string>;
    body: unknown;
    latencyMs: number;
    bodyPreviewHex: string;
    bodyPreviewAscii: string;
};

export type FtpCommandEntry = TraceEntryBase & {
    protocol: "FTP";
    direction: "command";
    ftpSessionId: string;
    rawCommand: string;
    commandVerb: string;
};

export type FtpResponseEntry = TraceEntryBase & {
    protocol: "FTP";
    direction: "response";
    ftpSessionId: string;
    code: number;
    rawResponse: string;
    latencyMs: number;
};

export type FtpDataEntry = TraceEntryBase & {
    protocol: "FTP";
    direction: "data";
    ftpSessionId: string;
    transferDirection: "upload" | "download";
    byteCount: number;
    durationMs: number;
    first256Hex: string;
    first256Ascii: string;
};

export type TraceEntry = RestRequestEntry | RestResponseEntry | FtpCommandEntry | FtpResponseEntry | FtpDataEntry;

export type ReplayRequest = {
    globalSeq: number;
    protocol: "REST" | "FTP";
    clientId: string;
    launchedAtMs: number;
    stageId?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: unknown;
    ftpSessionId?: string;
    commandVerb?: string;
    rawCommand?: string;
    transferDirection?: "upload" | "download";
    byteCount?: number;
};

export type ReplayManifest = {
    runSessionId: string;
    generatedAt: string;
    baseUrl: string;
    totalEntries: number;
    requests: ReplayRequest[];
};

export function nowMs(): number {
    return Date.now();
}

export function nowNs(): bigint {
    return process.hrtime.bigint();
}

export function makeBodyPreview(body: unknown): { hex: string; ascii: string } {
    const serialized = serializeTraceValue(body);
    const json = JSON.stringify(serialized ?? null);
    const buffer = Buffer.from(json, "utf8").subarray(0, 256);
    return {
        hex: buffer.toString("hex"),
        ascii: Array.from(buffer)
            .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "."))
            .join(""),
    };
}

export function previewBuffer(buffer: Buffer): { hex: string; ascii: string } {
    const slice = buffer.subarray(0, 256);
    return {
        hex: slice.toString("hex"),
        ascii: Array.from(slice)
            .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "."))
            .join(""),
    };
}

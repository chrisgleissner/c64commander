/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    analyzePlaybackLatencyEnvelope,
    type PlaybackLatencyMetric,
    type PlaybackLatencyOperation,
} from "./playbackVolumeLatencyMetrics.js";
import { captureAndAnalyzeStream } from "./stream/index.js";

type ParsedArgs = {
    host?: string;
    password?: string;
    songPath: string;
    artifactDir?: string;
    warmupMs: number;
    settleMs: number;
    burstIntervalMs: number;
};

type AudioMixerItem = {
    name: string;
    value: string;
    options: string[];
};

type OperationPlan = {
    label: string;
    kind: "volume" | "mute" | "unmute";
    requestedState: "loud" | "quiet" | "silent";
    requestedValue: string;
    pauseAfterMs: number;
};

type OperationRuntime = PlaybackLatencyOperation & {
    deviceConfirmationAtMs: number | null;
    deviceConfirmationValue: string | null;
};

type PlaybackLatencyArtifactMetric = PlaybackLatencyMetric & {
    deviceConfirmationAtMs: number | null;
    deviceConfirmationValue: string | null;
    usedFallbackEvidence: boolean;
    reportedLatencyMs: number | null;
};

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const host = args.host ?? (await resolveHealthyHost(args.password));
    const workspaceRoot = resolveWorkspaceRoot();
    const artifactDir =
        args.artifactDir ??
        path.join(
            workspaceRoot,
            "c64scope",
            "artifacts",
            "playback-volume-latency",
            `${new Date()
                .toISOString()
                .replace(/[:-]/g, "")
                .replace(/\.\d{3}Z$/, "Z")}-${host}`,
        );
    await mkdir(artifactDir, { recursive: true });

    const baseUrl = `http://${host}`;
    const audioMixerItems = await fetchAudioMixerItems(baseUrl, args.password);
    if (!audioMixerItems.length) {
        throw new Error(`No audio mixer volume items found on ${host}`);
    }

    const volumeNames = audioMixerItems.map((item) => item.name);
    const originalSnapshot = Object.fromEntries(audioMixerItems.map((item) => [item.name, item.value]));
    const volumeOptions = chooseVolumeOptions(audioMixerItems[0]!);
    const operationsPlan = buildOperationPlan(volumeOptions, args.settleMs, args.burstIntervalMs);
    const captureDurationMs =
        args.warmupMs + operationsPlan.reduce((sum, step) => sum + step.pauseAfterMs, 0) + Math.max(900, args.settleMs);

    await applyVolumeUpdate(baseUrl, args.password, volumeNames, volumeOptions.loud);
    await startPlayback(workspaceRoot, args.songPath, baseUrl, args.password);

    const captureStartedAt = Date.now();
    const capturePromise = captureAndAnalyzeStream({
        streamType: "audio",
        c64uHost: host,
        artifactDir,
        durationMs: captureDurationMs,
    });

    const operations: OperationRuntime[] = [];
    try {
        await sleep(args.warmupMs);
        for (const [index, step] of operationsPlan.entries()) {
            const requestIssuedAtMs = Date.now() - captureStartedAt;
            const operation: OperationRuntime = {
                id: `op-${String(index + 1).padStart(2, "0")}`,
                label: step.label,
                kind: step.kind,
                requestedValue: step.requestedValue,
                requestedState: step.requestedState,
                requestIssuedAtMs,
                restDispatchedAtMs: requestIssuedAtMs,
                restCompletedAtMs: null,
                deviceConfirmationAtMs: null,
                deviceConfirmationValue: null,
            };
            try {
                await applyVolumeUpdate(baseUrl, args.password, volumeNames, step.requestedValue);
                operation.restCompletedAtMs = Date.now() - captureStartedAt;
                const confirmedValue = await readCurrentAudioMixerValue(baseUrl, args.password, volumeNames[0]!);
                operation.deviceConfirmationAtMs = Date.now() - captureStartedAt;
                operation.deviceConfirmationValue = confirmedValue;
            } catch (error) {
                operation.requestError = error instanceof Error ? error.message : String(error);
            }
            operations.push(operation);
            await sleep(step.pauseAfterMs);
        }
    } finally {
        await applySnapshot(baseUrl, args.password, originalSnapshot).catch(() => undefined);
    }

    const capture = await capturePromise;
    const envelope = (capture.analysis.envelope as Array<Record<string, number>> | undefined)?.map((point) => ({
        receivedAtMs: Number(point.receivedAtMs ?? 0),
        packetDurationMs: Number(point.packetDurationMs ?? 0),
        rms: Number(point.rms ?? 0),
        peakAbs: Number(point.peakAbs ?? 0),
        samplePairs: Number(point.samplePairs ?? 0),
    }));
    if (!envelope?.length) {
        throw new Error(`Audio capture for ${host} completed without an analyzable envelope.`);
    }

    const metrics = attachFallbackEvidence(
        analyzePlaybackLatencyEnvelope(envelope, operations, capture.capture.durationMs),
        operations,
    );
    const summary = summarizeArtifactMetrics(metrics);
    const summaryPayload = {
        host,
        baseUrl,
        songPath: args.songPath,
        captureDurationMs,
        warmupMs: args.warmupMs,
        settleMs: args.settleMs,
        burstIntervalMs: args.burstIntervalMs,
        options: volumeOptions,
        summary,
        operations: metrics,
        captureArtifacts: {
            analysisPath: capture.analysisPath,
            packetsPath: capture.packetsPath,
        },
    };

    const summaryPath = path.join(artifactDir, "playback-volume-latency-summary.json");
    await writeFile(summaryPath, JSON.stringify(summaryPayload, null, 2), "utf8");

    console.log(`Playback volume latency host: ${host}`);
    console.log(`Artifacts: ${artifactDir}`);
    console.log(JSON.stringify(summary, null, 2));
    for (const metric of metrics) {
        console.log(
            [
                metric.id,
                metric.label,
                `requested=${metric.requestedValue}`,
                `requestMs=${metric.requestIssuedAtMs}`,
                `dispatchMs=${metric.restDispatchedAtMs}`,
                `completeMs=${metric.restCompletedAtMs ?? "null"}`,
                `effectMs=${metric.firstObservedAudioEffectAtMs ?? "null"}`,
                `deviceMs=${metric.deviceConfirmationAtMs ?? "null"}`,
                `latencyMs=${metric.reportedLatencyMs ?? "null"}`,
                `fallback=${metric.usedFallbackEvidence}`,
                `stale=${metric.staleIntermediateObserved}`,
                `final=${metric.finalTargetReached}`,
                metric.deviceConfirmationValue ? `confirmed=${metric.deviceConfirmationValue}` : null,
                metric.requestError ? `error=${metric.requestError}` : null,
            ]
                .filter(Boolean)
                .join(" "),
        );
    }
    console.log(`Summary JSON: ${summaryPath}`);
}

function parseArgs(argv: string[]): ParsedArgs {
    const defaults: ParsedArgs = {
        songPath: "tests/fixtures/local-source-assets/demo.sid",
        warmupMs: 1200,
        settleMs: 700,
        burstIntervalMs: 250,
    };
    const args = [...argv];
    while (args.length > 0) {
        const flag = args.shift();
        if (!flag) break;
        if (flag === "--host") {
            defaults.host = args.shift();
            continue;
        }
        if (flag === "--password") {
            defaults.password = args.shift();
            continue;
        }
        if (flag === "--song") {
            defaults.songPath = args.shift() ?? defaults.songPath;
            continue;
        }
        if (flag === "--artifact-dir") {
            defaults.artifactDir = args.shift();
            continue;
        }
        if (flag === "--warmup-ms") {
            defaults.warmupMs = parseIntegerArg(flag, args.shift(), defaults.warmupMs);
            continue;
        }
        if (flag === "--settle-ms") {
            defaults.settleMs = parseIntegerArg(flag, args.shift(), defaults.settleMs);
            continue;
        }
        if (flag === "--burst-interval-ms") {
            defaults.burstIntervalMs = parseIntegerArg(flag, args.shift(), defaults.burstIntervalMs);
            continue;
        }
        throw new Error(`Unknown argument: ${flag}`);
    }
    return defaults;
}

function parseIntegerArg(flag: string, value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for ${flag}: ${value}`);
    }
    return parsed;
}

async function resolveHealthyHost(password?: string): Promise<string> {
    for (const host of ["u64", "c64u"]) {
        if (await probeHost(host, password)) {
            return host;
        }
    }
    throw new Error("Neither u64 nor c64u responded to /v1/info within the probe timeout.");
}

async function probeHost(host: string, password?: string): Promise<boolean> {
    try {
        const response = await fetch(`http://${host}/v1/info`, {
            method: "GET",
            headers: buildHeaders(password),
            signal: AbortSignal.timeout(2500),
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function fetchAudioMixerItems(baseUrl: string, password?: string): Promise<AudioMixerItem[]> {
    const response = await fetch(`${baseUrl}/v1/configs/${encodeURIComponent("Audio Mixer")}`, {
        method: "GET",
        headers: buildHeaders(password),
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
        throw new Error(`Audio Mixer read failed (${response.status})`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const category = normalizeCategoryPayload(payload, "Audio Mixer");
    const items = Object.entries(category)
        .filter(([name]) => /^Vol (UltiSid|Socket)/i.test(name))
        .map(([name, item]) => normalizeAudioMixerItem(name, item))
        .filter((item): item is AudioMixerItem => item !== null);
    if (!items.length) {
        return [];
    }

    if (!items.some((item) => item.options.length > 0)) {
        const detailed = await fetchAudioMixerItemDetail(baseUrl, password, items[0]!.name);
        items[0] = detailed;
    }
    return items;
}

function normalizeCategoryPayload(payload: Record<string, unknown>, categoryName: string): Record<string, unknown> {
    const category = (payload[categoryName] ?? payload) as Record<string, unknown>;
    const items = (category.items ?? category) as Record<string, unknown>;
    return items && typeof items === "object" ? items : {};
}

function normalizeAudioMixerItem(name: string, item: unknown): AudioMixerItem | null {
    if (typeof item === "string") {
        return {
            name,
            value: item,
            options: [],
        };
    }
    if (typeof item !== "object" || item === null) {
        return null;
    }
    const record = item as Record<string, unknown>;
    const rawValue = record.selected ?? record.current ?? record.value ?? record.current_value ?? record.currentValue;
    const options = record.options ?? record.values ?? record.choices;
    return {
        name,
        value: String(rawValue ?? ""),
        options: Array.isArray(options) ? options.map((option) => String(option)) : [],
    };
}

async function fetchAudioMixerItemDetail(
    baseUrl: string,
    password: string | undefined,
    itemName: string,
): Promise<AudioMixerItem> {
    const response = await fetch(
        `${baseUrl}/v1/configs/${encodeURIComponent("Audio Mixer")}/${encodeURIComponent(itemName)}`,
        {
            method: "GET",
            headers: buildHeaders(password),
            signal: AbortSignal.timeout(5000),
        },
    );
    if (!response.ok) {
        throw new Error(`Audio Mixer detail read failed for ${itemName} (${response.status})`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const category = normalizeCategoryPayload(payload, "Audio Mixer");
    const item = normalizeAudioMixerItem(itemName, category[itemName]);
    if (!item) {
        throw new Error(`Audio Mixer detail payload for ${itemName} could not be normalized.`);
    }
    return item;
}

function chooseVolumeOptions(item: AudioMixerItem): { loud: string; quiet: string; mute: string } {
    const offOption = item.options.find(
        (option) => /^(off|mute|muted)$/i.test(option.trim()) || /-42\s*dB/i.test(option),
    );
    const numericOptions = item.options
        .filter((option) => option !== offOption)
        .map((option) => ({ option, numeric: parseNumericOption(option) }))
        .filter((entry): entry is { option: string; numeric: number } => entry.numeric !== null)
        .sort((left, right) => left.numeric - right.numeric);
    if (!numericOptions.length) {
        throw new Error(`Unable to derive loud/quiet volume options from ${item.name}`);
    }
    const loud = numericOptions[numericOptions.length - 1]!.option;
    const quiet = numericOptions[0]!.option;
    return {
        loud,
        quiet: quiet === loud && numericOptions.length > 1 ? numericOptions[0]!.option : quiet,
        mute: offOption ?? "-42 dB",
    };
}

function buildOperationPlan(
    options: { loud: string; quiet: string; mute: string },
    settleMs: number,
    burstIntervalMs: number,
): OperationPlan[] {
    return [
        {
            label: `volume:${options.quiet}`,
            kind: "volume",
            requestedState: "quiet",
            requestedValue: options.quiet,
            pauseAfterMs: settleMs,
        },
        {
            label: `volume:${options.loud}`,
            kind: "volume",
            requestedState: "loud",
            requestedValue: options.loud,
            pauseAfterMs: settleMs,
        },
        {
            label: `mute:${options.mute}`,
            kind: "mute",
            requestedState: "silent",
            requestedValue: options.mute,
            pauseAfterMs: settleMs,
        },
        {
            label: `unmute:${options.loud}`,
            kind: "unmute",
            requestedState: "loud",
            requestedValue: options.loud,
            pauseAfterMs: settleMs,
        },
        {
            label: `burst-volume:${options.quiet}:1`,
            kind: "volume",
            requestedState: "quiet",
            requestedValue: options.quiet,
            pauseAfterMs: burstIntervalMs,
        },
        {
            label: `burst-volume:${options.loud}:2`,
            kind: "volume",
            requestedState: "loud",
            requestedValue: options.loud,
            pauseAfterMs: burstIntervalMs,
        },
        {
            label: `burst-volume:${options.quiet}:3`,
            kind: "volume",
            requestedState: "quiet",
            requestedValue: options.quiet,
            pauseAfterMs: burstIntervalMs,
        },
        {
            label: `burst-volume:${options.loud}:4`,
            kind: "volume",
            requestedState: "loud",
            requestedValue: options.loud,
            pauseAfterMs: burstIntervalMs,
        },
        {
            label: `burst-mute:${options.mute}`,
            kind: "mute",
            requestedState: "silent",
            requestedValue: options.mute,
            pauseAfterMs: burstIntervalMs,
        },
        {
            label: `burst-unmute:${options.loud}`,
            kind: "unmute",
            requestedState: "loud",
            requestedValue: options.loud,
            pauseAfterMs: burstIntervalMs,
        },
    ];
}

async function applyVolumeUpdate(
    baseUrl: string,
    password: string | undefined,
    volumeNames: string[],
    value: string,
): Promise<void> {
    const payload = {
        "Audio Mixer": Object.fromEntries(volumeNames.map((name) => [name, value])),
    };
    const response = await fetch(`${baseUrl}/v1/configs`, {
        method: "POST",
        headers: {
            ...buildHeaders(password),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Audio Mixer write failed (${response.status}): ${body.slice(0, 240)}`);
    }
}

async function applySnapshot(
    baseUrl: string,
    password: string | undefined,
    snapshot: Record<string, string>,
): Promise<void> {
    const response = await fetch(`${baseUrl}/v1/configs`, {
        method: "POST",
        headers: {
            ...buildHeaders(password),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ "Audio Mixer": snapshot }),
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Audio Mixer restore failed (${response.status}): ${body.slice(0, 240)}`);
    }
}

async function readCurrentAudioMixerValue(
    baseUrl: string,
    password: string | undefined,
    itemName: string,
): Promise<string> {
    const item = await fetchAudioMixerItemDetail(baseUrl, password, itemName);
    return item.value;
}

async function startPlayback(
    workspaceRoot: string,
    songPath: string,
    baseUrl: string,
    password?: string,
): Promise<void> {
    const resolvedSongPath = path.resolve(workspaceRoot, songPath);
    const sidBuffer = await readFile(resolvedSongPath);
    const form = new FormData();
    form.append("file", new Blob([sidBuffer], { type: "audio/sid" }), path.basename(resolvedSongPath));
    const response = await fetch(`${baseUrl}/v1/runners:sidplay`, {
        method: "POST",
        headers: password ? { "X-Password": password } : undefined,
        body: form,
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`SID playback start failed (${response.status}): ${body.slice(0, 240)}`);
    }
    const payload = (await response.json().catch(() => ({ errors: [] }))) as { errors?: string[] };
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new Error(`SID playback start reported errors: ${payload.errors.join(", ")}`);
    }
}

function buildHeaders(password?: string): Record<string, string> {
    return password ? { Accept: "application/json", "X-Password": password } : { Accept: "application/json" };
}

function parseNumericOption(value: string): number | null {
    const match = value.match(/[+-]?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

function resolveWorkspaceRoot(): string {
    return path.basename(process.cwd()) === "c64scope" ? path.resolve(process.cwd(), "..") : process.cwd();
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachFallbackEvidence(
    metrics: readonly PlaybackLatencyMetric[],
    operations: readonly OperationRuntime[],
): PlaybackLatencyArtifactMetric[] {
    return metrics.map((metric) => {
        const runtime = operations.find((operation) => operation.id === metric.id);
        const deviceConfirmationMatches = runtime?.deviceConfirmationValue?.trim() === metric.requestedValue.trim();
        const usedFallbackEvidence = metric.firstObservedAudioEffectAtMs === null && Boolean(deviceConfirmationMatches);
        return {
            ...metric,
            deviceConfirmationAtMs: runtime?.deviceConfirmationAtMs ?? null,
            deviceConfirmationValue: runtime?.deviceConfirmationValue ?? null,
            usedFallbackEvidence,
            reportedLatencyMs:
                metric.totalLatencyMs ??
                (usedFallbackEvidence && typeof runtime?.deviceConfirmationAtMs === "number"
                    ? Math.max(0, runtime.deviceConfirmationAtMs - metric.requestIssuedAtMs)
                    : null),
            finalTargetReached: metric.finalTargetReached || Boolean(deviceConfirmationMatches),
        };
    });
}

function summarizeArtifactMetrics(metrics: readonly PlaybackLatencyArtifactMetric[]) {
    const samples = metrics
        .map((metric) => metric.reportedLatencyMs)
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right);
    return {
        count: metrics.length,
        minMs: percentile(samples, 0),
        medianMs: percentile(samples, 0.5),
        p90Ms: percentile(samples, 0.9),
        p95Ms: percentile(samples, 0.95),
        maxMs: percentile(samples, 1),
        failures: metrics.filter(
            (metric) => metric.requestError || metric.reportedLatencyMs === null || !metric.finalTargetReached,
        ).length,
        staleWrites: metrics.filter((metric) => metric.staleIntermediateObserved).length,
        cancellations: metrics.filter((metric) => metric.requestError?.toLowerCase().includes("abort")).length,
    };
}

function percentile(samples: readonly number[], fraction: number): number | null {
    if (!samples.length) {
        return null;
    }
    if (fraction <= 0) {
        return samples[0]!;
    }
    if (fraction >= 1) {
        return samples[samples.length - 1]!;
    }
    const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * fraction) - 1));
    return samples[index]!;
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

import { RestClient } from "../../lib/restClient.js";
import { Semaphore } from "../../lib/concurrency.js";
import { delay } from "../../lib/timing.js";
import type { HarnessConfig } from "../../lib/config.js";
import type { LogEventInput } from "../../lib/logging.js";

export type RestScenarioContext = {
    rest: RestClient;
    request: RestClient["request"];
    config: HarnessConfig;
    log: (event: LogEventInput) => void;
    recordConcurrencyObservation: (observation: ConcurrencyObservation) => void;
};

export type RestScenario = {
    id: string;
    safe: boolean;
    run: (ctx: RestScenarioContext) => Promise<void>;
};

export type ConcurrencyObservation = {
    scope: string;
    maxInFlight: number;
    failureMode: string;
    notes?: string;
};

const SAFE_CATEGORY_BLOCKLIST = ["network", "wifi", "modem", "drive", "http", "ftp", "telnet", "hostname", "password"];
const SAFE_ITEM_BLOCKLIST = ["password", "hostname", "ip", "mac", "dns", "gateway", "ssid", "token"];

export function buildRestScenarios(): RestScenario[] {
    return [
        {
            id: "rest.version",
            safe: true,
            run: async ({ request, log }) => {
                const response = await request({ method: "GET", url: "/v1/version" });
                log({
                    kind: "rest",
                    op: "GET /v1/version",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId }
                });
            }
        },
        {
            id: "rest.info",
            safe: true,
            run: async ({ request, log }) => {
                const response = await request({ method: "GET", url: "/v1/info" });
                log({
                    kind: "rest",
                    op: "GET /v1/info",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId }
                });
            }
        },
        {
            id: "rest.configs.list",
            safe: true,
            run: async ({ request, log }) => {
                const response = await request({ method: "GET", url: "/v1/configs" });
                log({
                    kind: "rest",
                    op: "GET /v1/configs",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId }
                });
            }
        },
        {
            id: "rest.drives.list",
            safe: true,
            run: async ({ request, log }) => {
                const response = await request({ method: "GET", url: "/v1/drives" });
                log({
                    kind: "rest",
                    op: "GET /v1/drives",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId }
                });
            }
        },
        {
            id: "rest.configs.safe-write",
            safe: true,
            run: async ({ request, log, config }) => {
                if (config.mode !== "SAFE") {
                    return;
                }
                const categoriesResp = await request({ method: "GET", url: "/v1/configs" });
                if (categoriesResp.status !== 200 || typeof categoriesResp.data !== "object" || categoriesResp.data === null) {
                    log({
                        kind: "rest",
                        op: "GET /v1/configs",
                        status: categoriesResp.status,
                        latencyMs: categoriesResp.latencyMs,
                        details: { correlationId: categoriesResp.correlationId }
                    });
                    return;
                }
                const categories = (categoriesResp.data as { categories?: string[] }).categories || [];
                const targetCategory = categories.find((name) => !isBlockedCategory(name));
                if (!targetCategory) {
                    log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "no safe category" });
                    return;
                }

                const detailResp = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(targetCategory)}` });
                if (detailResp.status !== 200 || typeof detailResp.data !== "object" || detailResp.data === null) {
                    log({
                        kind: "rest",
                        op: "GET /v1/configs/{category}",
                        status: detailResp.status,
                        latencyMs: detailResp.latencyMs,
                        details: { correlationId: detailResp.correlationId }
                    });
                    return;
                }

                const categoryObj = (detailResp.data as Record<string, unknown>)[targetCategory];
                if (!categoryObj || typeof categoryObj !== "object") {
                    log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "category shape" });
                    return;
                }

                const itemName = pickSafeItem(categoryObj as Record<string, unknown>);
                if (!itemName) {
                    log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "no safe item" });
                    return;
                }

                const itemDetailResp = await request({
                    method: "GET",
                    url: `/v1/configs/${encodeURIComponent(targetCategory)}/${encodeURIComponent(itemName)}`
                });
                if (itemDetailResp.status !== 200 || typeof itemDetailResp.data !== "object" || itemDetailResp.data === null) {
                    log({
                        kind: "rest",
                        op: "GET /v1/configs/{category}/{item}",
                        status: itemDetailResp.status,
                        latencyMs: itemDetailResp.latencyMs,
                        details: { correlationId: itemDetailResp.correlationId }
                    });
                    return;
                }

                const itemDetail = (itemDetailResp.data as Record<string, unknown>)[targetCategory] as Record<string, unknown> | undefined;
                const itemEntry = itemDetail ? (itemDetail[itemName] as Record<string, unknown> | undefined) : undefined;
                if (!itemEntry || typeof itemEntry !== "object") {
                    log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "item detail" });
                    return;
                }

                const current = itemEntry.current ?? itemEntry;
                const nextValue = pickNextValue(itemEntry, current);
                if (nextValue === undefined) {
                    log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "no reversible value" });
                    return;
                }

                const setResp = await request({
                    method: "PUT",
                    url: `/v1/configs/${encodeURIComponent(targetCategory)}/${encodeURIComponent(itemName)}`,
                    params: { value: nextValue }
                });
                log({
                    kind: "rest",
                    op: "PUT /v1/configs/{category}/{item}",
                    status: setResp.status,
                    latencyMs: setResp.latencyMs,
                    details: { correlationId: setResp.correlationId }
                });

                const restoreValue = typeof current === "string" || typeof current === "number"
                    ? current
                    : undefined;
                if (restoreValue !== undefined) {
                    await delay(200);
                    const restoreResp = await request({
                        method: "PUT",
                        url: `/v1/configs/${encodeURIComponent(targetCategory)}/${encodeURIComponent(itemName)}`,
                        params: { value: restoreValue }
                    });
                    log({
                        kind: "rest",
                        op: "PUT /v1/configs/{category}/{item} restore",
                        status: restoreResp.status,
                        latencyMs: restoreResp.latencyMs,
                        details: { correlationId: restoreResp.correlationId }
                    });
                }
            }
        },
        {
            id: "rest.configs.concurrent",
            safe: true,
            run: async ({ request, log, config, recordConcurrencyObservation }) => {
                const observation: ConcurrencyObservation = {
                    scope: "REST /v1/configs concurrent",
                    maxInFlight: config.concurrency.restMaxInFlight,
                    failureMode: "none"
                };

                const target = await pickConfigTarget(request, log);
                const beforeValue = target?.value ?? null;

                const totalRequests = Math.max(3, config.concurrency.restMaxInFlight * 3);
                const results = await runConcurrentRequests({
                    request,
                    log,
                    maxInFlight: config.concurrency.restMaxInFlight,
                    totalRequests,
                    targets: [{ op: "GET /v1/configs", url: "/v1/configs" }]
                });

                const failures = results.filter((result) => !result.ok).length;
                if (failures > 0) {
                    observation.failureMode = "errors";
                    observation.notes = `${failures}/${results.length} requests failed`;
                }

                if (target) {
                    const afterValue = await readConfigValue(request, target.category, target.item, log);
                    if (afterValue !== null && beforeValue !== null && afterValue !== beforeValue) {
                        observation.failureMode = "config-drift";
                        observation.notes = `value changed for ${target.category}/${target.item}: ${String(beforeValue)} -> ${String(afterValue)}`;
                    }
                }

                const maxLatency = Math.max(...results.map((result) => result.latencyMs ?? 0));
                if (maxLatency > 0) {
                    observation.notes = observation.notes
                        ? `${observation.notes}; max latency ${maxLatency}ms`
                        : `max latency ${maxLatency}ms`;
                }

                recordConcurrencyObservation(observation);
            }
        },
        {
            id: "rest.concurrent.mix",
            safe: true,
            run: async ({ request, log, config, recordConcurrencyObservation }) => {
                const observation: ConcurrencyObservation = {
                    scope: "REST mixed concurrent",
                    maxInFlight: config.concurrency.restMaxInFlight,
                    failureMode: "none"
                };
                const targets = [
                    { op: "GET /v1/version", url: "/v1/version" },
                    { op: "GET /v1/info", url: "/v1/info" },
                    { op: "GET /v1/drives", url: "/v1/drives" },
                    { op: "GET /v1/configs", url: "/v1/configs" }
                ];
                const totalRequests = Math.max(4, config.concurrency.restMaxInFlight * 4);
                const results = await runConcurrentRequests({
                    request,
                    log,
                    maxInFlight: config.concurrency.restMaxInFlight,
                    totalRequests,
                    targets
                });

                const failures = results.filter((result) => !result.ok).length;
                if (failures > 0) {
                    observation.failureMode = "errors";
                    observation.notes = `${failures}/${results.length} requests failed`;
                }

                const maxLatency = Math.max(...results.map((result) => result.latencyMs ?? 0));
                if (maxLatency > 0) {
                    observation.notes = observation.notes
                        ? `${observation.notes}; max latency ${maxLatency}ms`
                        : `max latency ${maxLatency}ms`;
                }

                recordConcurrencyObservation(observation);
            }
        },
        {
            id: "rest.machine.reset",
            safe: false,
            run: async ({ request, log, config }) => {
                if (config.mode !== "STRESS") {
                    return;
                }
                if (!config.allowMachineReset) {
                    log({ kind: "rest", op: "machine.reset", status: "skipped", reason: "allowMachineReset=false" });
                    return;
                }
                const response = await request({ method: "PUT", url: "/v1/machine:reset" });
                log({
                    kind: "rest",
                    op: "PUT /v1/machine:reset",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId }
                });

                await delay(1000);
                const probe = await request({ method: "GET", url: "/v1/version" });
                log({
                    kind: "rest",
                    op: "GET /v1/version (post-reset)",
                    status: probe.status,
                    latencyMs: probe.latencyMs,
                    details: { correlationId: probe.correlationId }
                });
            }
        },
        {
            id: "rest.files.create-d64",
            safe: false,
            run: async ({ request, log, config }) => {
                if (config.mode !== "STRESS") {
                    return;
                }
                const media = config.media;
                if (!media?.diskImagePath) {
                    log({ kind: "rest", op: "files.create-d64", status: "skipped", reason: "diskImagePath not set" });
                    return;
                }
                if (!media.diskImagePath.toLowerCase().endsWith(".d64")) {
                    log({ kind: "rest", op: "files.create-d64", status: "skipped", reason: "diskImagePath is not .d64" });
                    return;
                }
                const encodedPath = encodeFilePath(media.diskImagePath);
                const response = await request({
                    method: "PUT",
                    url: `/v1/files/${encodedPath}:create_d64`,
                    params: { tracks: 35, diskname: "C64COMM" }
                });
                log({
                    kind: "rest",
                    op: "PUT /v1/files/{path}:create_d64",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId, path: media.diskImagePath }
                });
            }
        },
        {
            id: "rest.drives.mount",
            safe: false,
            run: async ({ request, log, config }) => {
                if (config.mode !== "STRESS") {
                    return;
                }
                const media = config.media;
                if (!media?.diskImagePath) {
                    log({ kind: "rest", op: "drives.mount", status: "skipped", reason: "diskImagePath not set" });
                    return;
                }
                const drive = media.diskDrive ?? "a";
                const mountResp = await request({
                    method: "PUT",
                    url: `/v1/drives/${drive}:mount`,
                    params: {
                        image: media.diskImagePath,
                        type: media.diskType,
                        mode: media.diskMode
                    }
                });
                log({
                    kind: "rest",
                    op: "PUT /v1/drives/{drive}:mount",
                    status: mountResp.status,
                    latencyMs: mountResp.latencyMs,
                    details: { correlationId: mountResp.correlationId, drive }
                });

                await delay(200);
                const removeResp = await request({ method: "PUT", url: `/v1/drives/${drive}:remove` });
                log({
                    kind: "rest",
                    op: "PUT /v1/drives/{drive}:remove",
                    status: removeResp.status,
                    latencyMs: removeResp.latencyMs,
                    details: { correlationId: removeResp.correlationId, drive }
                });
            }
        },
        {
            id: "rest.runners.sidplay",
            safe: false,
            run: async ({ request, log, config }) => {
                if (config.mode !== "STRESS") {
                    return;
                }
                const media = config.media;
                if (!media?.sidFilePath) {
                    log({ kind: "rest", op: "runners.sidplay", status: "skipped", reason: "sidFilePath not set" });
                    return;
                }
                const response = await request({
                    method: "PUT",
                    url: "/v1/runners:sidplay",
                    params: { file: media.sidFilePath, songnr: media.sidSongNr }
                });
                log({
                    kind: "rest",
                    op: "PUT /v1/runners:sidplay",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId }
                });
            }
        },
        {
            id: "rest.runners.prg",
            safe: false,
            run: async ({ request, log, config }) => {
                if (config.mode !== "STRESS") {
                    return;
                }
                const media = config.media;
                if (!media?.prgFilePath) {
                    log({ kind: "rest", op: "runners.prg", status: "skipped", reason: "prgFilePath not set" });
                    return;
                }
                const action = media.prgAction ?? "run";
                const response = await request({
                    method: "PUT",
                    url: action === "load" ? "/v1/runners:load_prg" : "/v1/runners:run_prg",
                    params: { file: media.prgFilePath }
                });
                log({
                    kind: "rest",
                    op: `PUT /v1/runners:${action}_prg`,
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId }
                });
            }
        }
    ];
}

function isBlockedCategory(name: string): boolean {
    const lower = name.toLowerCase();
    return SAFE_CATEGORY_BLOCKLIST.some((token) => lower.includes(token));
}

function isBlockedItem(name: string): boolean {
    const lower = name.toLowerCase();
    return SAFE_ITEM_BLOCKLIST.some((token) => lower.includes(token));
}

function encodeFilePath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    return trimmed
        .split("/")
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

async function pickConfigTarget(
    request: RestClient["request"],
    log: (event: LogEventInput) => void
): Promise<{ category: string; item: string; value: string | number | null } | null> {
    const categoriesResp = await request({ method: "GET", url: "/v1/configs" });
    if (categoriesResp.status !== 200 || typeof categoriesResp.data !== "object" || categoriesResp.data === null) {
        log({
            kind: "rest",
            op: "GET /v1/configs",
            status: categoriesResp.status,
            latencyMs: categoriesResp.latencyMs,
            details: { correlationId: categoriesResp.correlationId }
        });
        return null;
    }
    const categories = (categoriesResp.data as { categories?: string[] }).categories || [];
    const targetCategory = categories.find((name) => !isBlockedCategory(name));
    if (!targetCategory) {
        return null;
    }
    const detailResp = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(targetCategory)}` });
    if (detailResp.status !== 200 || typeof detailResp.data !== "object" || detailResp.data === null) {
        log({
            kind: "rest",
            op: "GET /v1/configs/{category}",
            status: detailResp.status,
            latencyMs: detailResp.latencyMs,
            details: { correlationId: detailResp.correlationId }
        });
        return null;
    }
    const categoryObj = (detailResp.data as Record<string, unknown>)[targetCategory];
    if (!categoryObj || typeof categoryObj !== "object") {
        return null;
    }
    const itemName = pickSafeItem(categoryObj as Record<string, unknown>);
    if (!itemName) {
        return null;
    }
    const value = await readConfigValue(request, targetCategory, itemName, log);
    return { category: targetCategory, item: itemName, value };
}

async function readConfigValue(
    request: RestClient["request"],
    category: string,
    item: string,
    log: (event: LogEventInput) => void
): Promise<string | number | null> {
    const itemDetailResp = await request({
        method: "GET",
        url: `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}`
    });
    if (itemDetailResp.status !== 200 || typeof itemDetailResp.data !== "object" || itemDetailResp.data === null) {
        log({
            kind: "rest",
            op: "GET /v1/configs/{category}/{item}",
            status: itemDetailResp.status,
            latencyMs: itemDetailResp.latencyMs,
            details: { correlationId: itemDetailResp.correlationId }
        });
        return null;
    }
    const itemDetail = (itemDetailResp.data as Record<string, unknown>)[category] as Record<string, unknown> | undefined;
    const itemEntry = itemDetail ? (itemDetail[item] as Record<string, unknown> | undefined) : undefined;
    if (!itemEntry || typeof itemEntry !== "object") {
        return null;
    }
    const current = itemEntry.current ?? itemEntry;
    if (typeof current === "string" || typeof current === "number") {
        return current;
    }
    return null;
}

async function runConcurrentRequests({
    request,
    log,
    maxInFlight,
    totalRequests,
    targets
}: {
    request: RestClient["request"];
    log: (event: LogEventInput) => void;
    maxInFlight: number;
    totalRequests: number;
    targets: Array<{ op: string; url: string }>;
}): Promise<Array<{ ok: boolean; latencyMs: number | null }>> {
    const semaphore = new Semaphore(maxInFlight);
    return Promise.all(
        Array.from({ length: totalRequests }, async (_, index) => {
            const release = await semaphore.acquire();
            const target = targets[index % targets.length];
            try {
                const response = await request({ method: "GET", url: target.url });
                log({
                    kind: "rest",
                    op: target.op,
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId, concurrent: true }
                });
                return { ok: response.status === 200, latencyMs: response.latencyMs };
            } catch (error) {
                log({
                    kind: "rest",
                    op: target.op,
                    status: "error",
                    details: { error: String(error), concurrent: true }
                });
                return { ok: false, latencyMs: null };
            } finally {
                release();
            }
        })
    );
}

function pickSafeItem(items: Record<string, unknown>): string | null {
    for (const key of Object.keys(items)) {
        if (isBlockedItem(key)) {
            continue;
        }
        const value = items[key];
        if (typeof value === "object" && value !== null) {
            return key;
        }
        if (typeof value === "number" || typeof value === "string") {
            return key;
        }
    }
    return null;
}

function pickNextValue(itemEntry: Record<string, unknown>, current: unknown): string | number | undefined {
    if (typeof current === "number") {
        const min = itemEntry.min as number | undefined;
        const max = itemEntry.max as number | undefined;
        if (typeof min === "number" && typeof max === "number") {
            if (current + 1 <= max) {
                return current + 1;
            }
            if (current - 1 >= min) {
                return current - 1;
            }
        }
    }

    const values = itemEntry.values as unknown[] | undefined;
    if (Array.isArray(values) && typeof current === "string") {
        const next = values.find((value) => value !== current);
        if (typeof next === "string") {
            return next;
        }
    }

    return undefined;
}

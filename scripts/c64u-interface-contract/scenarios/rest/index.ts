import { RestClient } from "../../lib/restClient.js";
import { Semaphore } from "../../lib/concurrency.js";
import { delay } from "../../lib/timing.js";
import type { HarnessConfig } from "../../lib/config.js";
import type { LogEventInput } from "../../lib/logging.js";
import { FtpClient } from "../../lib/ftpClient.js";

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
const DISK_EXTENSIONS = [".d64", ".d71", ".d81", ".dnp", ".g64"];
const SID_EXTENSIONS = [".sid"];
const PRG_EXTENSIONS = [".prg"];
const mediaDiscoveryCache = new Map<string, string | null>();

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
                const resolvedPath = await resolveMediaFilePath({
                    basePath: media.diskImagePath,
                    extensions: DISK_EXTENSIONS,
                    config,
                    log,
                    label: "disk image"
                });
                if (!resolvedPath) {
                    log({ kind: "rest", op: "drives.mount", status: "skipped", reason: "no disk image found" });
                    return;
                }
                const drive = media.diskDrive ?? "a";
                const mountResp = await request({
                    method: "PUT",
                    url: `/v1/drives/${drive}:mount`,
                    params: {
                        image: resolvedPath,
                        type: media.diskType,
                        mode: media.diskMode
                    }
                });
                log({
                    kind: "rest",
                    op: "PUT /v1/drives/{drive}:mount",
                    status: mountResp.status,
                    latencyMs: mountResp.latencyMs,
                    details: { correlationId: mountResp.correlationId, drive, image: resolvedPath }
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
                const resolvedPath = await resolveMediaFilePath({
                    basePath: media.sidFilePath,
                    extensions: SID_EXTENSIONS,
                    config,
                    log,
                    label: "sid file"
                });
                if (!resolvedPath) {
                    log({ kind: "rest", op: "runners.sidplay", status: "skipped", reason: "no sid file found" });
                    return;
                }
                const response = await request({
                    method: "PUT",
                    url: "/v1/runners:sidplay",
                    params: { file: resolvedPath, songnr: media.sidSongNr }
                });
                log({
                    kind: "rest",
                    op: "PUT /v1/runners:sidplay",
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId, file: resolvedPath }
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
                const resolvedPath = await resolveMediaFilePath({
                    basePath: media.prgFilePath,
                    extensions: PRG_EXTENSIONS,
                    config,
                    log,
                    label: "prg file"
                });
                if (!resolvedPath) {
                    log({ kind: "rest", op: "runners.prg", status: "skipped", reason: "no prg file found" });
                    return;
                }
                const action = media.prgAction ?? "run";
                const response = await request({
                    method: "PUT",
                    url: action === "load" ? "/v1/runners:load_prg" : "/v1/runners:run_prg",
                    params: { file: resolvedPath }
                });
                log({
                    kind: "rest",
                    op: `PUT /v1/runners:${action}_prg`,
                    status: response.status,
                    latencyMs: response.latencyMs,
                    details: { correlationId: response.correlationId, file: resolvedPath }
                });
            }
        }
    ];
}

function hasMatchingExtension(value: string, extensions: string[]): boolean {
    const lower = value.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext));
}

async function resolveMediaFilePath({
    basePath,
    extensions,
    config,
    log,
    label
}: {
    basePath: string;
    extensions: string[];
    config: HarnessConfig;
    log: (event: LogEventInput) => void;
    label: string;
}): Promise<string | null> {
    if (!basePath.trim()) {
        return null;
    }
    if (hasMatchingExtension(basePath, extensions)) {
        return basePath;
    }
    const cacheKey = `${label}:${basePath.toLowerCase()}`;
    if (mediaDiscoveryCache.has(cacheKey)) {
        return mediaDiscoveryCache.get(cacheKey) ?? null;
    }

    const client = new FtpClient({
        host: new URL(config.baseUrl).hostname,
        port: 21,
        user: "anonymous",
        password: config.auth === "ON" ? config.password || "" : "",
        mode: config.ftpMode,
        timeoutMs: config.timeouts.ftpTimeoutMs
    });

    try {
        await client.connect();
        log({ kind: "ftp", op: "discover.connect", details: { sessionId: client.sessionId, label, basePath } });
        const resolved = await findFirstMatchingFile(client, basePath, extensions);
        if (!resolved) {
            log({ kind: "ftp", op: "discover.search", status: "not-found", details: { label, basePath } });
        } else {
            log({ kind: "ftp", op: "discover.search", status: "found", details: { label, basePath, resolved } });
        }
        mediaDiscoveryCache.set(cacheKey, resolved ?? null);
        return resolved ?? null;
    } catch (error) {
        log({
            kind: "ftp",
            op: "discover.error",
            status: "error",
            details: { label, basePath, message: String(error) }
        });
        mediaDiscoveryCache.set(cacheKey, null);
        return null;
    } finally {
        await client.close();
    }
}

type MlsdEntry = { name: string; type: "dir" | "file" };

async function findFirstMatchingFile(client: FtpClient, rootPath: string, extensions: string[]): Promise<string | null> {
    const queue: string[] = [normalizeFtpPath(rootPath)];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current)) {
            continue;
        }
        visited.add(current);

        const { result, data } = await client.mlsd(current);
        if (result.response.code >= 400) {
            throw new Error(`FTP MLSD failed for ${current}: ${result.response.code} ${result.response.message}`);
        }

        const entries = parseMlsdEntries(data);
        const ordered = entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of ordered) {
            const entryPath = joinFtpPath(current, entry.name);
            if (entry.type === "file" && hasMatchingExtension(entry.name, extensions)) {
                return entryPath;
            }
            if (entry.type === "dir") {
                queue.push(entryPath);
            }
        }
    }

    return null;
}

function parseMlsdEntries(data: string): MlsdEntry[] {
    const entries: MlsdEntry[] = [];
    for (const line of data.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const entry = parseMlsdLine(trimmed);
        if (!entry) {
            continue;
        }
        if (entry.name === "." || entry.name === "..") {
            continue;
        }
        entries.push(entry);
    }
    return entries;
}

function parseMlsdLine(line: string): MlsdEntry | null {
    const separatorIndex = line.indexOf(" ");
    if (separatorIndex <= 0) {
        return null;
    }
    const facts = line.slice(0, separatorIndex).split(";");
    const name = line.slice(separatorIndex + 1).trim();
    if (!name) {
        return null;
    }
    let type = "";
    for (const fact of facts) {
        if (!fact) {
            continue;
        }
        const [key, value] = fact.split("=");
        if (key?.toLowerCase() === "type") {
            type = (value ?? "").toLowerCase();
            break;
        }
    }
    if (type === "dir" || type === "cdir" || type === "pdir") {
        return { name, type: "dir" };
    }
    if (type === "file") {
        return { name, type: "file" };
    }
    return null;
}

function joinFtpPath(base: string, name: string): string {
    if (base.endsWith("/")) {
        return `${base}${name}`;
    }
    if (base === "/") {
        return `/${name}`;
    }
    return `${base}/${name}`;
}

function normalizeFtpPath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return "/";
    }
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
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

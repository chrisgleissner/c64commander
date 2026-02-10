/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig } from "./lib/config.js";
import { startContractMockServers, type ContractMockServers } from "./mockServers.js";
import { RestClient } from "./lib/restClient.js";
import { buildRestScenarios } from "./scenarios/rest/index.js";
import { buildFtpScenarios } from "./scenarios/ftp/index.js";
import { buildMixedScenarios } from "./scenarios/mixed/index.js";
import { HealthMonitor } from "./lib/health.js";
import { LatencyTracker, deriveCooldown, delay } from "./lib/timing.js";
import { SchemaValidator, schemaPath } from "./lib/schema.js";
import type { LogEventInput } from "./lib/logging.js";
import yaml from "js-yaml";

type LogEvent = LogEventInput & { timestamp: string };
type ConcurrencyObservation = { scope: string; maxInFlight: number; failureMode: string; notes?: string };

const args = parseArgs(process.argv.slice(2));
let config = loadConfig(args.configPath);
let mockServers: ContractMockServers | null = null;
if (process.env.CONTRACT_TEST_TARGET?.toLowerCase() === "mock") {
    mockServers = await startContractMockServers();
    config = {
        ...config,
        baseUrl: mockServers.baseUrl,
        ftpPort: mockServers.ftpPort,
    };
}

const runId = `${formatTimestamp(new Date())}-${config.mode}-${config.auth}`;
const runRoot = path.join(process.cwd(), config.outputDir, "runs", runId);
const latestRoot = path.join(process.cwd(), config.outputDir, "latest");

fs.mkdirSync(runRoot, { recursive: true });
fs.mkdirSync(latestRoot, { recursive: true });

const logStream = fs.createWriteStream(path.join(runRoot, "logs.ndjson"), { flags: "a" });
const latencyMap = new Map<string, { kind: "REST" | "FTP"; tracker: LatencyTracker }>();
const concurrencyObservations: ConcurrencyObservation[] = [];

const log = (event: LogEventInput) => {
    const payload: LogEvent = { timestamp: new Date().toISOString(), ...event };
    logStream.write(`${JSON.stringify(payload)}\n`);
    if (event.latencyMs !== undefined && (event.kind === "rest" || event.kind === "ftp")) {
        const key = `${event.kind}:${event.op}`;
        if (!latencyMap.has(key)) {
            latencyMap.set(key, { kind: event.kind === "ftp" ? "FTP" : "REST", tracker: new LatencyTracker() });
        }
        latencyMap.get(key)?.tracker.record(event.latencyMs);
    }
};

const restClient = new RestClient({
    baseUrl: config.baseUrl,
    auth: config.auth,
    password: config.password,
    timeoutMs: config.timeouts.restTimeoutMs,
    keepAlive: config.http?.keepAlive ?? true,
    maxSockets: config.http?.maxSockets ?? 8
});

const restRequest = createRestRequest(restClient, config.mode);

const healthMonitor = new HealthMonitor(
    async () => {
        try {
            const response = await withTimeout(
                restClient.request({ method: "GET", url: config.health.endpoint }),
                config.health.timeoutMs,
                `Health probe timeout: ${config.health.endpoint}`
            );
            return { ok: response.status === 200, status: response.status, latencyMs: response.latencyMs };
        } catch (error) {
            console.warn("Health probe failed", { error: String(error) });
            return { ok: false, error: String(error) };
        }
    },
    { maxConsecutiveFailures: 3, maxUnreachableMs: 30000 }
);

const restScenarios = filterScenarios(buildRestScenarios(), config.scenarios?.rest);
const ftpScenarios = filterScenarios(buildFtpScenarios(), config.scenarios?.ftp);
const mixedScenarios = filterScenarios(buildMixedScenarios(), config.scenarios?.mixed);

try {
    await runScenarioGroup("rest", restScenarios, async (scenario) => {
        await runScenario(scenario.id, scenario.safe, () => scenario.run({
            rest: restClient,
            request: restRequest,
            config,
            log,
            recordConcurrencyObservation: (observation) => {
                concurrencyObservations.push(observation);
            }
        }));
    });

    await runScenarioGroup("ftp", ftpScenarios, async (scenario) => {
        await runScenario(scenario.id, scenario.safe, () => scenario.run({ config, log }));
    });

    await runScenarioGroup("mixed", mixedScenarios, async (scenario) => {
        await runScenario(scenario.id, scenario.safe, () => scenario.run({ rest: restClient, request: restRequest, config, log }));
    });

    const latencyStats = buildLatencyStats(latencyMap, config);
    const restCooldowns = buildCooldowns(latencyStats, "REST", config);
    const ftpCooldowns = buildCooldowns(latencyStats, "FTP", config);

    const endpoints = loadOpenApiEndpoints(config);
    const ftpCommands = [
        "USER",
        "PASS",
        "QUIT",
        "PORT",
        "CWD",
        "CDUP",
        "PWD",
        "NLST",
        "LIST",
        "RETR",
        "STOR",
        "NOOP",
        "SYST",
        "ABOR",
        "TYPE",
        "MODE",
        "RNFR",
        "RNTO",
        "MKD",
        "RMD",
        "DELE",
        "SIZE",
        "PASV",
        "MLST",
        "MLSD",
        "FEAT"
    ];

    const endpointsPayload = {
        generatedAt: new Date().toISOString(),
        mode: config.mode,
        auth: config.auth,
        rest: endpoints,
        ftp: ftpCommands.map((command) => ({ command, safe: true }))
    };

    const concurrencyPayload = {
        generatedAt: new Date().toISOString(),
        mode: config.mode,
        auth: config.auth,
        limits: config.concurrency,
        observations: concurrencyObservations
    };

    const conflictsPayload = {
        generatedAt: new Date().toISOString(),
        mode: config.mode,
        auth: config.auth,
        conflicts: extractConflictsFromLogs()
    };

    function extractConflictsFromLogs(): Array<{ primary: string; secondary: string; overlap: string; evidence: string }> {
        const logsPath = path.join(runRoot, "logs.ndjson");
        if (!fs.existsSync(logsPath)) return [];
        const lines = fs.readFileSync(logsPath, "utf8").split("\n").filter(Boolean);
        const results: Array<{ primary: string; secondary: string; overlap: string; evidence: string }> = [];
        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                if (event.kind !== "conflict") continue;
                const d = event.details;
                if (!d || !d.pair) continue;
                const parts = d.pair.split(" × ");
                results.push({
                    primary: parts[0] || d.pair,
                    secondary: parts[1] || d.pair,
                    overlap: d.conflict ? "forbidden" : "allowed",
                    evidence: `aOk=${d.aOk} bOk=${d.bOk} aLatency=${d.aLatencyMs}ms bLatency=${d.bLatencyMs}ms`
                });
            } catch (error) {
                console.warn("Failed to parse conflict log line", { error: String(error) });
            }
        }
        return results;
    }

    const meta = await buildMeta(config);

    writeJson(path.join(runRoot, "meta.json"), meta);
    writeJson(path.join(runRoot, "endpoints.json"), endpointsPayload);
    writeJson(path.join(runRoot, "latency-stats.json"), latencyStats);
    writeJson(path.join(runRoot, "rest-cooldowns.json"), restCooldowns);
    writeJson(path.join(runRoot, "ftp-cooldowns.json"), ftpCooldowns);
    writeJson(path.join(runRoot, "concurrency.json"), concurrencyPayload);
    writeJson(path.join(runRoot, "conflicts.json"), conflictsPayload);

    const validator = new SchemaValidator();
    validateOrThrow(validator, schemaPath("endpoints.schema.json"), path.join(runRoot, "endpoints.json"));
    validateOrThrow(validator, schemaPath("latency.schema.json"), path.join(runRoot, "latency-stats.json"));
    validateOrThrow(validator, schemaPath("cooldowns.schema.json"), path.join(runRoot, "rest-cooldowns.json"));
    validateOrThrow(validator, schemaPath("cooldowns.schema.json"), path.join(runRoot, "ftp-cooldowns.json"));
    validateOrThrow(validator, schemaPath("concurrency.schema.json"), path.join(runRoot, "concurrency.json"));
    validateOrThrow(validator, schemaPath("conflicts.schema.json"), path.join(runRoot, "conflicts.json"));

    copyLatest(runRoot, latestRoot, [
        "meta.json",
        "logs.ndjson",
        "endpoints.json",
        "latency-stats.json",
        "rest-cooldowns.json",
        "ftp-cooldowns.json",
        "concurrency.json",
        "conflicts.json"
    ]);
} finally {
    try {
        await rebootAndRecover(restClient, config);
    } finally {
        logStream.end();
        if (mockServers) {
            await mockServers.close();
        }
    }
}

async function runScenarioGroup<T extends { id: string }>(
    label: string,
    scenarios: T[],
    runner: (scenario: T) => Promise<void>
): Promise<void> {
    for (const scenario of scenarios) {
        await runner(scenario);
        const abort = healthMonitor.shouldAbort();
        if (abort.abort) {
            throw new Error(`Abort after ${label}:${scenario.id} - ${abort.reason}`);
        }
        await delay(config.pacing.restMinDelayMs);
    }
}

async function runScenario(id: string, safe: boolean, run: () => Promise<void>): Promise<void> {
    if (config.mode === "SAFE" && !safe) {
        log({ kind: "scenario", op: id, status: "skipped", details: { reason: "unsafe in SAFE" } });
        return;
    }
    const pre = await healthMonitor.check();
    log({ kind: "health", op: `${id}:pre`, status: pre.status ?? "fail", latencyMs: pre.latencyMs });

    let abortError: Error | null = null;
    let checking = false;
    const interval = setInterval(() => {
        if (checking) {
            return;
        }
        checking = true;
        healthMonitor
            .check()
            .then((result) => {
                log({ kind: "health", op: `${id}:periodic`, status: result.status ?? "fail", latencyMs: result.latencyMs });
                const abort = healthMonitor.shouldAbort();
                if (abort.abort && !abortError) {
                    abortError = new Error(`Abort during ${id}: ${abort.reason}`);
                }
            })
            .catch((error) => {
                console.warn("Periodic health probe failed", { error: String(error) });
            })
            .finally(() => {
                checking = false;
            });
    }, config.health.intervalMs);

    try {
        await withTimeout(run(), config.timeouts.scenarioTimeoutMs, `Scenario timeout: ${id}`);
        if (abortError) {
            throw abortError;
        }
    } catch (error) {
        const isAbort = abortError !== null;
        log({ kind: "scenario", op: id, status: isAbort ? "abort" : "error", details: { message: String(error) } });
        if (isAbort) {
            throw error;
        }
        // Non-abort errors: log and continue to next scenario
    } finally {
        clearInterval(interval);
    }

    const post = await healthMonitor.check();
    log({ kind: "health", op: `${id}:post`, status: post.status ?? "fail", latencyMs: post.latencyMs });
}

function buildLatencyStats(
    latency: Map<string, { kind: "REST" | "FTP"; tracker: LatencyTracker }>,
    cfg: typeof config
): {
    generatedAt: string;
    mode: string;
    auth: string;
    operations: Array<Record<string, unknown>>;
} {
    const operations = Array.from(latency.entries())
        .map(([key, value]) => {
            const summary = value.tracker.summary();
            if (!summary) {
                return null;
            }
            return {
                id: key,
                kind: value.kind,
                samples: summary.samples,
                p50: summary.p50,
                p90: summary.p90,
                p95: summary.p95,
                p99: summary.p99,
                min: summary.min,
                max: summary.max,
                mean: summary.mean
            };
        })
        .filter(Boolean) as Array<Record<string, unknown>>;

    return {
        generatedAt: new Date().toISOString(),
        mode: cfg.mode,
        auth: cfg.auth,
        operations
    };
}

function buildCooldowns(
    latencyStats: { operations: Array<Record<string, unknown>>; generatedAt: string; mode: string; auth: string },
    kind: "REST" | "FTP",
    cfg: typeof config
) {
    return {
        generatedAt: latencyStats.generatedAt,
        mode: cfg.mode,
        auth: cfg.auth,
        operations: latencyStats.operations
            .filter((op) => op.kind === kind)
            .map((op) => {
                const tracker = latencyMap.get(op.id as string);
                const summary = tracker?.tracker.summary();
                if (!summary) {
                    return null;
                }
                const cooldown = deriveCooldown(summary);
                return {
                    id: op.id,
                    kind,
                    minDelayMs: cooldown.minDelayMs,
                    recommendedDelayMs: cooldown.recommendedDelayMs,
                    maxDelayMs: cooldown.maxDelayMs,
                    basis: "p50/p90/p99"
                };
            })
            .filter(Boolean)
    };
}

async function buildMeta(cfg: typeof config) {
    const openapiPath = path.join(process.cwd(), "doc/c64/c64u-openapi.yaml");
    const openapiHash = fs.existsSync(openapiPath) ? hashFile(openapiPath) : "";
    const firmwareHash = getGitHash(path.join(process.cwd(), "1541ultimate"));
    const repoHash = getGitHash(process.cwd());

    let info: unknown = null;
    try {
        const response = await restClient.request({ method: "GET", url: "/v1/info" });
        if (response.status === 200) {
            info = response.data;
        }
    } catch (error) {
        console.warn("Failed to read /v1/info", { error: String(error) });
        info = null;
    }

    return {
        startedAt: new Date().toISOString(),
        baseUrl: cfg.baseUrl,
        mode: cfg.mode,
        auth: cfg.auth,
        ftpMode: cfg.ftpMode,
        openapiHash,
        firmwareHash,
        repoHash,
        deviceInfo: info
    };
}

function loadOpenApiEndpoints(cfg: typeof config) {
    const filePath = path.join(process.cwd(), "doc/c64/c64u-openapi.yaml");
    if (!fs.existsSync(filePath)) {
        return [] as Array<{ id: string; method: string; path: string; group: string; safe: boolean }>;
    }
    const doc = yaml.load(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const paths = (doc.paths || {}) as Record<string, Record<string, unknown>>;
    const endpoints: Array<{ id: string; method: string; path: string; group: string; safe: boolean }> = [];

    for (const [pathKey, methods] of Object.entries(paths)) {
        for (const [method] of Object.entries(methods)) {
            if (!isHttpMethod(method)) {
                continue;
            }
            const id = `${method.toUpperCase()} ${pathKey}`;
            const group = pathKey.split("/")[2] || "root";
            const safe = method.toUpperCase() === "GET";
            endpoints.push({ id, method: method.toUpperCase(), path: pathKey, group, safe });
        }
    }
    return endpoints;
}

function isHttpMethod(method: string): boolean {
    return ["get", "post", "put", "delete", "patch"].includes(method.toLowerCase());
}

function writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function validateOrThrow(validator: SchemaValidator, schemaFile: string, dataFile: string): void {
    const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const result = validator.validate(schemaFile, data);
    if (!result.valid) {
        throw new Error(`Schema validation failed for ${dataFile}: ${result.errors?.join("; ")}`);
    }
}

function copyLatest(sourceDir: string, targetDir: string, files: string[]): void {
    for (const file of files) {
        const src = path.join(sourceDir, file);
        const dest = path.join(targetDir, file);
        fs.copyFileSync(src, dest);
    }
}

async function rebootAndRecover(client: RestClient, cfg: typeof config): Promise<void> {
    const timeoutMs = 120_000;
    const pollIntervalMs = 2_000;
    const start = Date.now();

    try {
        await client.request({ method: "PUT", url: "/v1/machine:reboot" });
    } catch (error) {
        console.warn("Reboot request failed", { error: String(error), baseUrl: cfg.baseUrl });
    }

    while (Date.now() - start < timeoutMs) {
        try {
            const response = await client.request({ method: "GET", url: "/v1/info" });
            if (response.status === 200) {
                return;
            }
        } catch (error) {
            console.warn("Recovery probe failed", { error: String(error) });
        }
        await delay(pollIntervalMs);
    }

    throw new Error(`Contract test recovery timed out after ${timeoutMs}ms`);
}

function hashFile(filePath: string): string {
    const data = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
}

function getGitHash(repoPath: string): string {
    try {
        const head = fs.readFileSync(path.join(repoPath, ".git/HEAD"), "utf8").trim();
        if (head.startsWith("ref:")) {
            const ref = head.replace("ref:", "").trim();
            const refPath = path.join(repoPath, ".git", ref);
            return fs.readFileSync(refPath, "utf8").trim();
        }
        return head;
    } catch (error) {
        console.warn("Failed to read git hash", { repoPath, error: String(error) });
        return "";
    }
}

function parseArgs(argv: string[]): { configPath?: string } {
    const result: { configPath?: string } = {};
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--config") {
            result.configPath = argv[i + 1];
            i += 1;
        }
    }
    return result;
}

function formatTimestamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
        date.getMinutes()
    )}${pad(date.getSeconds())}`;
}

function filterScenarios<T extends { id: string }>(scenarios: T[], enabled?: string[]): T[] {
    if (!enabled || enabled.length === 0) {
        return scenarios;
    }
    return scenarios.filter((scenario) => enabled.includes(scenario.id));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timer = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    try {
        return await Promise.race([promise, timer]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

function createRestRequest(client: RestClient, mode: "SAFE" | "STRESS") {
    if (mode !== "STRESS") {
        return (config: Parameters<RestClient["request"]>[0]) => client.request(config);
    }
    return async (req: Parameters<RestClient["request"]>[0]) => {
        const maxRetries = 2;
        const baseDelayMs = 200;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            try {
                const response = await client.request(req);
                if (response.status >= 500 && attempt < maxRetries) {
                    const waitMs = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
                    console.warn("REST retryable response", { status: response.status, attempt, waitMs });
                    await delay(waitMs);
                    continue;
                }
                return response;
            } catch (error) {
                if (attempt >= maxRetries) {
                    throw error;
                }
                const waitMs = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
                console.warn("REST request failed, retrying", { error: String(error), attempt, waitMs });
                await delay(waitMs);
            }
        }
        throw new Error("REST retry loop exhausted");
    };
}

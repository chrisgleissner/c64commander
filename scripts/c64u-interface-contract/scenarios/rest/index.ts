import { RestClient } from "../../lib/restClient.js";
import { delay } from "../../lib/timing.js";
import type { HarnessConfig } from "../../lib/config.js";
import type { LogEventInput } from "../../lib/logging.js";

export type RestScenarioContext = {
    rest: RestClient;
    request: RestClient["request"];
    config: HarnessConfig;
    log: (event: LogEventInput) => void;
};

export type RestScenario = {
    id: string;
    safe: boolean;
    run: (ctx: RestScenarioContext) => Promise<void>;
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

                await delay(200);

                const restoreResp = await request({
                    method: "PUT",
                    url: `/v1/configs/${encodeURIComponent(targetCategory)}/${encodeURIComponent(itemName)}`,
                    params: { value: current }
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

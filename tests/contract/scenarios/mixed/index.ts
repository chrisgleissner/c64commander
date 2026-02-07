import type { HarnessConfig } from "../../lib/config.js";
import { RestClient } from "../../lib/restClient.js";
import { FtpClient } from "../../lib/ftpClient.js";
import { delay } from "../../lib/timing.js";
import type { LogEventInput } from "../../lib/logging.js";

export type MixedScenarioContext = {
    rest: RestClient;
    request: RestClient["request"];
    config: HarnessConfig;
    log: (event: LogEventInput) => void;
};

export type MixedScenario = {
    id: string;
    safe: boolean;
    run: (ctx: MixedScenarioContext) => Promise<void>;
};

function makeFtpClient(config: HarnessConfig): FtpClient {
    return new FtpClient({
        host: new URL(config.baseUrl).hostname,
        port: config.ftpPort ?? 21,
        user: "anonymous",
        password: config.auth === "ON" ? config.password || "" : "",
        mode: config.ftpMode,
        timeoutMs: config.timeouts.ftpTimeoutMs
    });
}

export function buildMixedScenarios(): MixedScenario[] {
    return [
        // ── REST × REST conflict matrix ──────────────────────────────────

        {
            id: "conflict.rest-x-rest",
            safe: true,
            run: async ({ request, log, config }) => {
                const cooldownMs = config.pacing.restMinDelayMs;
                const pairs: Array<[string, string, () => Promise<{ status: number; latencyMs: number }>, () => Promise<{ status: number; latencyMs: number }>]> = [
                    [
                        "GET version", "GET version",
                        async () => { const r = await request({ method: "GET", url: "/v1/version" }); return { status: r.status, latencyMs: r.latencyMs }; },
                        async () => { const r = await request({ method: "GET", url: "/v1/version" }); return { status: r.status, latencyMs: r.latencyMs }; }
                    ],
                    [
                        "GET version", "GET configs",
                        async () => { const r = await request({ method: "GET", url: "/v1/version" }); return { status: r.status, latencyMs: r.latencyMs }; },
                        async () => { const r = await request({ method: "GET", url: "/v1/configs" }); return { status: r.status, latencyMs: r.latencyMs }; }
                    ],
                    [
                        "GET configs", "GET drives",
                        async () => { const r = await request({ method: "GET", url: "/v1/configs" }); return { status: r.status, latencyMs: r.latencyMs }; },
                        async () => { const r = await request({ method: "GET", url: "/v1/drives" }); return { status: r.status, latencyMs: r.latencyMs }; }
                    ],
                    [
                        "GET version", "GET drives",
                        async () => { const r = await request({ method: "GET", url: "/v1/version" }); return { status: r.status, latencyMs: r.latencyMs }; },
                        async () => { const r = await request({ method: "GET", url: "/v1/drives" }); return { status: r.status, latencyMs: r.latencyMs }; }
                    ],
                    [
                        "GET configs", "GET configs",
                        async () => { const r = await request({ method: "GET", url: "/v1/configs" }); return { status: r.status, latencyMs: r.latencyMs }; },
                        async () => { const r = await request({ method: "GET", url: "/v1/configs" }); return { status: r.status, latencyMs: r.latencyMs }; }
                    ],
                ];

                for (const [nameA, nameB, fnA, fnB] of pairs) {
                    const [a, b] = await Promise.all([fnA(), fnB()]);
                    const aOk = a.status < 400;
                    const bOk = b.status < 400;
                    const conflict = !aOk || !bOk;
                    log({ kind: "conflict", op: "rest×rest", details: { pair: `${nameA} × ${nameB}`, aOk, bOk, aLatencyMs: a.latencyMs, bLatencyMs: b.latencyMs, conflict } });
                    await delay(cooldownMs);
                }
            }
        },

        // ── FTP × FTP conflict matrix ────────────────────────────────────

        {
            id: "conflict.ftp-x-ftp",
            safe: true,
            run: async ({ config, log }) => {
                const cooldownMs = config.pacing.ftpMinDelayMs;
                const clientA = makeFtpClient(config);
                const clientB = makeFtpClient(config);
                try {
                    await clientA.connect();
                    await clientB.connect();

                    // Concurrent LIST × LIST
                    const [listA, listB] = await Promise.all([
                        clientA.list("/").catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) })),
                        clientB.list("/").catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) }))
                    ]);
                    log({
                        kind: "conflict", op: "ftp×ftp", details: {
                            pair: "LIST × LIST",
                            aOk: listA.result.response.code < 400,
                            bOk: listB.result.response.code < 400,
                            aLatencyMs: listA.result.latencyMs,
                            bLatencyMs: listB.result.latencyMs,
                            conflict: listA.result.response.code >= 400 || listB.result.response.code >= 400
                        }
                    });

                    await delay(cooldownMs);

                    // Concurrent LIST × MLSD
                    const [listC, mlsdA] = await Promise.all([
                        clientA.list("/").catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) })),
                        clientB.mlsd().catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) }))
                    ]);
                    log({
                        kind: "conflict", op: "ftp×ftp", details: {
                            pair: "LIST × MLSD",
                            aOk: listC.result.response.code < 400,
                            bOk: mlsdA.result.response.code < 400,
                            aLatencyMs: listC.result.latencyMs,
                            bLatencyMs: mlsdA.result.latencyMs,
                            conflict: listC.result.response.code >= 400 || mlsdA.result.response.code >= 400
                        }
                    });

                    await delay(cooldownMs);

                    // Concurrent STOR × LIST
                    const payload = Buffer.from("c64u-conflict-test", "utf8");
                    await clientA.cwd(config.scratch.ftpDir);
                    const [storR, listD] = await Promise.all([
                        clientA.stor("conflict-probe.txt", payload).catch((e) => ({ response: { code: 500 }, latencyMs: 0, error: String(e) })),
                        clientB.list("/").catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) }))
                    ]);
                    const storOk = "response" in storR && storR.response.code < 400;
                    const listDOk = "result" in listD && listD.result.response.code < 400;
                    log({
                        kind: "conflict", op: "ftp×ftp", details: {
                            pair: "STOR × LIST",
                            aOk: storOk, bOk: listDOk,
                            aLatencyMs: "latencyMs" in storR ? storR.latencyMs : 0,
                            bLatencyMs: "result" in listD ? listD.result.latencyMs : 0,
                            conflict: !storOk || !listDOk
                        }
                    });

                    // Cleanup
                    try {
                        await clientA.dele("conflict-probe.txt");
                    } catch (cleanupError) {
                        console.warn("FTP cleanup delete failed", { error: String(cleanupError) });
                    }

                } catch (error) {
                    log({ kind: "conflict", op: "ftp×ftp", status: "error", details: { message: String(error) } });
                } finally {
                    await Promise.all([
                        clientA.close().catch((closeError) => {
                            console.warn("FTP client A close failed", { error: String(closeError) });
                        }),
                        clientB.close().catch((closeError) => {
                            console.warn("FTP client B close failed", { error: String(closeError) });
                        })
                    ]);
                }
            }
        },

        // ── REST × FTP conflict matrix ───────────────────────────────────

        {
            id: "conflict.rest-x-ftp",
            safe: true,
            run: async ({ request, config, log }) => {
                const cooldownMs = config.pacing.restMinDelayMs;
                const ftp = makeFtpClient(config);
                try {
                    await ftp.connect();

                    // REST GET version × FTP LIST
                    const [restVersion, ftpList] = await Promise.all([
                        request({ method: "GET", url: "/v1/version" }).catch((e) => ({ status: 500, latencyMs: 0, error: String(e) })),
                        ftp.list("/").catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) }))
                    ]);
                    log({
                        kind: "conflict", op: "rest×ftp", details: {
                            pair: "REST GET version × FTP LIST",
                            aOk: restVersion.status < 400,
                            bOk: ftpList.result.response.code < 400,
                            aLatencyMs: restVersion.latencyMs,
                            bLatencyMs: ftpList.result.latencyMs,
                            conflict: restVersion.status >= 400 || ftpList.result.response.code >= 400
                        }
                    });

                    await delay(cooldownMs);

                    // REST GET configs × FTP LIST
                    const [restConfigs, ftpList2] = await Promise.all([
                        request({ method: "GET", url: "/v1/configs" }).catch((e) => ({ status: 500, latencyMs: 0, error: String(e) })),
                        ftp.list("/").catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) }))
                    ]);
                    log({
                        kind: "conflict", op: "rest×ftp", details: {
                            pair: "REST GET configs × FTP LIST",
                            aOk: restConfigs.status < 400,
                            bOk: ftpList2.result.response.code < 400,
                            aLatencyMs: restConfigs.latencyMs,
                            bLatencyMs: ftpList2.result.latencyMs,
                            conflict: restConfigs.status >= 400 || ftpList2.result.response.code >= 400
                        }
                    });

                    await delay(cooldownMs);

                    // REST GET drives × FTP MLSD
                    const [restDrives, ftpMlsd] = await Promise.all([
                        request({ method: "GET", url: "/v1/drives" }).catch((e) => ({ status: 500, latencyMs: 0, error: String(e) })),
                        ftp.mlsd().catch((e) => ({ result: { response: { code: 500 }, latencyMs: 0 }, data: "", error: String(e) }))
                    ]);
                    log({
                        kind: "conflict", op: "rest×ftp", details: {
                            pair: "REST GET drives × FTP MLSD",
                            aOk: restDrives.status < 400,
                            bOk: ftpMlsd.result.response.code < 400,
                            aLatencyMs: restDrives.latencyMs,
                            bLatencyMs: ftpMlsd.result.latencyMs,
                            conflict: restDrives.status >= 400 || ftpMlsd.result.response.code >= 400
                        }
                    });

                    await delay(cooldownMs);

                    // REST GET version × FTP STOR
                    await ftp.cwd(config.scratch.ftpDir);
                    const payload = Buffer.from("rest-ftp-conflict", "utf8");
                    const [restV2, ftpStor] = await Promise.all([
                        request({ method: "GET", url: "/v1/version" }).catch((e) => ({ status: 500, latencyMs: 0, error: String(e) })),
                        ftp.stor("conflict-rest-ftp.txt", payload).catch((e) => ({ response: { code: 500 }, latencyMs: 0, error: String(e) }))
                    ]);
                    const storOk = "response" in ftpStor && ftpStor.response.code < 400;
                    log({
                        kind: "conflict", op: "rest×ftp", details: {
                            pair: "REST GET version × FTP STOR",
                            aOk: restV2.status < 400,
                            bOk: storOk,
                            aLatencyMs: restV2.latencyMs,
                            bLatencyMs: "latencyMs" in ftpStor ? ftpStor.latencyMs : 0,
                            conflict: restV2.status >= 400 || !storOk
                        }
                    });

                    // Cleanup
                    try {
                        await ftp.dele("conflict-rest-ftp.txt");
                    } catch (cleanupError) {
                        console.warn("FTP cleanup delete failed", { error: String(cleanupError) });
                    }

                } catch (error) {
                    log({ kind: "conflict", op: "rest×ftp", status: "error", details: { message: String(error) } });
                } finally {
                    await ftp.close().catch((closeError) => {
                        console.warn("FTP close failed", { error: String(closeError) });
                    });
                }
            }
        },

        // ── Rapid sequential REST then FTP ───────────────────────────────

        {
            id: "conflict.sequential-rest-then-ftp",
            safe: true,
            run: async ({ request, config, log }) => {
                const ftp = makeFtpClient(config);
                try {
                    // Fire REST requests rapidly
                    for (let i = 0; i < 5; i++) {
                        const r = await request({ method: "GET", url: "/v1/version" });
                        log({ kind: "mixed", op: "rapid-rest-burst", status: r.status, latencyMs: r.latencyMs, details: { iteration: i } });
                    }

                    // Immediately switch to FTP
                    await ftp.connect();
                    const list = await ftp.list("/");
                    log({ kind: "mixed", op: "ftp-after-rest-burst", status: list.result.response.code, latencyMs: list.result.latencyMs });
                } catch (error) {
                    log({ kind: "mixed", op: "sequential-rest-then-ftp", status: "error", details: { message: String(error) } });
                } finally {
                    await ftp.close().catch((closeError) => {
                        console.warn("FTP close failed", { error: String(closeError) });
                    });
                }
            }
        }
    ];
}

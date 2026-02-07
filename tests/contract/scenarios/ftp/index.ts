import type { HarnessConfig } from "../../lib/config.js";
import { FtpClient } from "../../lib/ftpClient.js";
import { delay } from "../../lib/timing.js";
import type { LogEventInput } from "../../lib/logging.js";

export type FtpScenarioContext = {
    config: HarnessConfig;
    log: (event: LogEventInput) => void;
};

export type FtpScenario = {
    id: string;
    safe: boolean;
    run: (ctx: FtpScenarioContext) => Promise<void>;
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

export function buildFtpScenarios(): FtpScenario[] {
    return [
        // ── Full command sweep ────────────────────────────────────────────

        {
            id: "ftp.basic",
            safe: true,
            run: async ({ config, log }) => {
                const client = makeFtpClient(config);
                try {
                    await client.connect();
                    log({ kind: "ftp", op: "connect", details: { sessionId: client.sessionId } });

                    // SYST
                    const syst = await client.sendCommand("SYST");
                    log({ kind: "ftp", op: "SYST", status: syst.response.code, latencyMs: syst.latencyMs, details: { sessionId: client.sessionId } });

                    // FEAT
                    const feat = await client.sendCommand("FEAT");
                    log({ kind: "ftp", op: "FEAT", status: feat.response.code, latencyMs: feat.latencyMs, details: { sessionId: client.sessionId } });

                    // TYPE I
                    const typeI = await client.sendCommand("TYPE I");
                    log({ kind: "ftp", op: "TYPE", status: typeI.response.code, latencyMs: typeI.latencyMs, details: { sessionId: client.sessionId } });

                    // TYPE A
                    const typeA = await client.sendCommand("TYPE A");
                    log({ kind: "ftp", op: "TYPE A", status: typeA.response.code, latencyMs: typeA.latencyMs, details: { sessionId: client.sessionId } });

                    // MODE S
                    const modeS = await client.sendCommand("MODE S");
                    log({ kind: "ftp", op: "MODE", status: modeS.response.code, latencyMs: modeS.latencyMs, details: { sessionId: client.sessionId } });

                    // NOOP
                    const noop = await client.sendCommand("NOOP");
                    log({ kind: "ftp", op: "NOOP", status: noop.response.code, latencyMs: noop.latencyMs, details: { sessionId: client.sessionId } });

                    // PWD
                    const pwd = await client.pwd();
                    log({ kind: "ftp", op: "PWD", status: pwd.response.code, latencyMs: pwd.latencyMs, details: { sessionId: client.sessionId } });

                    // MKD scratch dir
                    const scratchDir = config.scratch.ftpDir;
                    const mkd = await client.mkd(scratchDir);
                    log({ kind: "ftp", op: "MKD", status: mkd.response.code, latencyMs: mkd.latencyMs, details: { sessionId: client.sessionId } });

                    // CWD
                    const cwd = await client.cwd(scratchDir);
                    log({ kind: "ftp", op: "CWD", status: cwd.response.code, latencyMs: cwd.latencyMs, details: { sessionId: client.sessionId, path: scratchDir } });

                    // LIST
                    const list = await client.list();
                    log({ kind: "ftp", op: "LIST", status: list.result.response.code, latencyMs: list.result.latencyMs, details: { sessionId: client.sessionId, lines: list.data.split("\n").length } });

                    // NLST
                    const nlst = await client.nlst();
                    log({ kind: "ftp", op: "NLST", status: nlst.result.response.code, latencyMs: nlst.result.latencyMs, details: { sessionId: client.sessionId } });

                    // MLSD
                    const mlsd = await client.mlsd();
                    log({ kind: "ftp", op: "MLSD", status: mlsd.result.response.code, latencyMs: mlsd.result.latencyMs, details: { sessionId: client.sessionId } });

                    // MLST
                    const mlst = await client.mlst();
                    log({ kind: "ftp", op: "MLST", status: mlst.response.code, latencyMs: mlst.latencyMs, details: { sessionId: client.sessionId } });

                    // STOR
                    const payload = Buffer.from("c64u-contract-test-probe", "utf8");
                    const stor = await client.stor("probe.txt", payload);
                    log({ kind: "ftp", op: "STOR", status: stor.response.code, latencyMs: stor.latencyMs, details: { sessionId: client.sessionId, size: payload.length } });

                    await delay(100);

                    // SIZE
                    const size = await client.size("probe.txt");
                    log({ kind: "ftp", op: "SIZE", status: size.response.code, latencyMs: size.latencyMs, details: { sessionId: client.sessionId } });

                    // RETR
                    const retr = await client.retr("probe.txt");
                    log({ kind: "ftp", op: "RETR", status: retr.result.response.code, latencyMs: retr.result.latencyMs, details: { sessionId: client.sessionId, receivedBytes: retr.data.length } });

                    // RNFR + RNTO
                    const rnfr = await client.rnfr("probe.txt");
                    log({ kind: "ftp", op: "RNFR", status: rnfr.response.code, latencyMs: rnfr.latencyMs, details: { sessionId: client.sessionId } });
                    const rnto = await client.rnto("probe-renamed.txt");
                    log({ kind: "ftp", op: "RNTO", status: rnto.response.code, latencyMs: rnto.latencyMs, details: { sessionId: client.sessionId } });

                    // DELE
                    const dele = await client.dele("probe-renamed.txt");
                    log({ kind: "ftp", op: "DELE", status: dele.response.code, latencyMs: dele.latencyMs, details: { sessionId: client.sessionId } });

                    // CDUP
                    const cdup = await client.sendCommand("CDUP");
                    log({ kind: "ftp", op: "CDUP", status: cdup.response.code, latencyMs: cdup.latencyMs, details: { sessionId: client.sessionId } });

                    // ABOR (should be harmless)
                    const abor = await client.sendCommand("ABOR");
                    log({ kind: "ftp", op: "ABOR", status: abor.response.code, latencyMs: abor.latencyMs, details: { sessionId: client.sessionId } });

                } catch (error) {
                    log({ kind: "ftp", op: "session", status: "error", details: { message: String(error) } });
                } finally {
                    await client.close();
                }
            }
        },

        // ── Concurrent FTP sessions ──────────────────────────────────────

        {
            id: "ftp.concurrent-sessions",
            safe: true,
            run: async ({ config, log }) => {
                for (const n of [2, 3]) {
                    const sessions = Array.from({ length: n }, () => makeFtpClient(config));
                    const results: Array<{ ok: boolean; latencyMs: number }> = [];
                    try {
                        // Connect all sessions
                        await Promise.all(sessions.map(async (s) => {
                            try {
                                await s.connect();
                                log({ kind: "ftp", op: `concurrent-connect N=${n}`, details: { sessionId: s.sessionId } });
                            } catch (error) {
                                log({ kind: "ftp", op: `concurrent-connect N=${n}`, status: "error", details: { sessionId: s.sessionId, message: String(error) } });
                            }
                        }));

                        // Run LIST on each concurrently
                        const listResults = await Promise.all(sessions.map(async (s) => {
                            try {
                                const r = await s.list("/");
                                log({ kind: "ftp", op: `LIST concurrent N=${n}`, status: r.result.response.code, latencyMs: r.result.latencyMs, details: { sessionId: s.sessionId } });
                                return { ok: r.result.response.code < 400, latencyMs: r.result.latencyMs };
                            } catch (error) {
                                log({ kind: "ftp", op: `LIST concurrent N=${n}`, status: "error", details: { sessionId: s.sessionId, message: String(error) } });
                                return { ok: false, latencyMs: 0 };
                            }
                        }));
                        results.push(...listResults);

                        const failures = results.filter((r) => !r.ok).length;
                        const maxLatency = Math.max(...results.map((r) => r.latencyMs));
                        log({ kind: "ftp", op: `concurrent-summary N=${n}`, details: { failures, total: results.length, maxLatencyMs: maxLatency } });

                        if (failures > 0) break; // Don't escalate if already failing
                    } finally {
                        await Promise.all(
                            sessions.map((s) =>
                                s.close().catch((closeError) => {
                                    console.warn("FTP session close failed", { error: String(closeError), sessionId: s.sessionId });
                                })
                            )
                        );
                    }
                }
            }
        },

        // ── Large file upload/download ───────────────────────────────────

        {
            id: "ftp.large-transfer",
            safe: true,
            run: async ({ config, log }) => {
                const client = makeFtpClient(config);
                try {
                    await client.connect();
                    await client.cwd(config.scratch.ftpDir);

                    // Upload 64KB file
                    const payload = Buffer.alloc(65536, 0x42);
                    const stor = await client.stor("large-probe.bin", payload);
                    log({ kind: "ftp", op: "STOR large", status: stor.response.code, latencyMs: stor.latencyMs, details: { size: payload.length } });

                    await delay(200);

                    // Download it back
                    const retr = await client.retr("large-probe.bin");
                    log({ kind: "ftp", op: "RETR large", status: retr.result.response.code, latencyMs: retr.result.latencyMs, details: { receivedBytes: retr.data.length } });

                    // Verify size
                    if (retr.data.length !== payload.length) {
                        log({ kind: "ftp", op: "large-transfer-verify", status: "mismatch", details: { expected: payload.length, actual: retr.data.length } });
                    }

                    // Cleanup
                    await client.dele("large-probe.bin");
                } catch (error) {
                    log({ kind: "ftp", op: "large-transfer", status: "error", details: { message: String(error) } });
                } finally {
                    await client.close();
                }
            }
        },

        // ── FTP while REST is active ─────────────────────────────────────

        {
            id: "ftp.during-rest-load",
            safe: true,
            run: async ({ config, log }) => {
                // This tests FTP stability when REST requests are in-flight
                // Mixed scenario is handled in mixed/index.ts but we add FTP-side perspective here
                const client = makeFtpClient(config);
                try {
                    await client.connect();
                    await client.cwd(config.scratch.ftpDir);
                    const list = await client.list();
                    log({ kind: "ftp", op: "LIST (rest-load bg)", status: list.result.response.code, latencyMs: list.result.latencyMs });
                    const mlsd = await client.mlsd();
                    log({ kind: "ftp", op: "MLSD (rest-load bg)", status: mlsd.result.response.code, latencyMs: mlsd.result.latencyMs });
                } catch (error) {
                    log({ kind: "ftp", op: "during-rest-load", status: "error", details: { message: String(error) } });
                } finally {
                    await client.close();
                }
            }
        }
    ];
}

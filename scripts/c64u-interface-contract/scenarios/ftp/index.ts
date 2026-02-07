import type { HarnessConfig } from "../../lib/config.js";
import { FtpClient } from "../../lib/ftpClient.js";
import { delay } from "../../lib/timing.js";

export type FtpScenarioContext = {
    config: HarnessConfig;
    log: (event: Record<string, unknown>) => void;
};

export type FtpScenario = {
    id: string;
    safe: boolean;
    run: (ctx: FtpScenarioContext) => Promise<void>;
};

export function buildFtpScenarios(): FtpScenario[] {
    return [
        {
            id: "ftp.basic",
            safe: true,
            run: async ({ config, log }) => {
                const client = new FtpClient({
                    host: new URL(config.baseUrl).hostname,
                    port: 21,
                    user: "anonymous",
                    password: config.auth === "ON" ? config.password || "" : "",
                    mode: config.ftpMode,
                    timeoutMs: config.timeouts.ftpTimeoutMs
                });

                await client.connect();
                log({ kind: "ftp", op: "connect", details: { sessionId: client.sessionId } });

                const pwd = await client.pwd();
                log({ kind: "ftp", op: "PWD", status: pwd.response.code, latencyMs: pwd.latencyMs, details: { sessionId: client.sessionId } });

                const scratchDir = config.scratch.ftpDir;
                const mkd = await client.mkd(scratchDir);
                log({ kind: "ftp", op: "MKD", status: mkd.response.code, latencyMs: mkd.latencyMs, details: { sessionId: client.sessionId } });

                const cwd = await client.cwd(scratchDir);
                log({ kind: "ftp", op: "CWD", status: cwd.response.code, latencyMs: cwd.latencyMs, details: { sessionId: client.sessionId, path: scratchDir } });

                const list = await client.list();
                log({ kind: "ftp", op: "LIST", status: list.result.response.code, latencyMs: list.result.latencyMs, details: { sessionId: client.sessionId } });

                const mlsd = await client.mlsd();
                log({ kind: "ftp", op: "MLSD", status: mlsd.result.response.code, latencyMs: mlsd.result.latencyMs, details: { sessionId: client.sessionId } });

                const mlst = await client.mlst();
                log({ kind: "ftp", op: "MLST", status: mlst.response.code, latencyMs: mlst.latencyMs, details: { sessionId: client.sessionId } });

                const payload = Buffer.from("c64u-interface-contract", "utf8");
                const stor = await client.stor("probe.txt", payload);
                log({ kind: "ftp", op: "STOR", status: stor.response.code, latencyMs: stor.latencyMs, details: { sessionId: client.sessionId } });

                await delay(100);

                const retr = await client.retr("probe.txt");
                log({ kind: "ftp", op: "RETR", status: retr.result.response.code, latencyMs: retr.result.latencyMs, details: { sessionId: client.sessionId } });

                const rnfr = await client.rnfr("probe.txt");
                log({ kind: "ftp", op: "RNFR", status: rnfr.response.code, latencyMs: rnfr.latencyMs, details: { sessionId: client.sessionId } });

                const rnto = await client.rnto("probe-renamed.txt");
                log({ kind: "ftp", op: "RNTO", status: rnto.response.code, latencyMs: rnto.latencyMs, details: { sessionId: client.sessionId } });

                const dele = await client.dele("probe-renamed.txt");
                log({ kind: "ftp", op: "DELE", status: dele.response.code, latencyMs: dele.latencyMs, details: { sessionId: client.sessionId } });

                await client.close();
            }
        }
    ];
}

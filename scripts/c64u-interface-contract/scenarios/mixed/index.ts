import type { HarnessConfig } from "../../lib/config.js";
import { RestClient } from "../../lib/restClient.js";
import { FtpClient } from "../../lib/ftpClient.js";
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

export function buildMixedScenarios(): MixedScenario[] {
    return [
        {
            id: "mixed.rest-while-ftp",
            safe: true,
            run: async ({ request, config, log }) => {
                const ftp = new FtpClient({
                    host: new URL(config.baseUrl).hostname,
                    port: 21,
                    user: "anonymous",
                    password: config.auth === "ON" ? config.password || "" : "",
                    mode: config.ftpMode,
                    timeoutMs: config.timeouts.ftpTimeoutMs
                });

                await ftp.connect();
                try {
                    await ftp.cwd(config.scratch.ftpDir);
                } catch (error) {
                    log({ kind: "mixed", op: "ftp.cwd", status: "error", details: { message: String(error) } });
                }

                const restPromise = request({ method: "GET", url: "/v1/version" });
                const ftpPromise = ftp.list();

                const [restResp, ftpResp] = await Promise.all([restPromise, ftpPromise]);
                log({
                    kind: "mixed",
                    op: "rest+ftp",
                    status: restResp.status,
                    latencyMs: restResp.latencyMs,
                    details: { correlationId: restResp.correlationId }
                });
                log({ kind: "ftp", op: "LIST", status: ftpResp.result.response.code, latencyMs: ftpResp.result.latencyMs });

                await ftp.close();
            }
        }
    ];
}

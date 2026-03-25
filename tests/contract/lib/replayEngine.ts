/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { randomUUID } from "node:crypto";
import { RestClient } from "./restClient.js";
import { createRestRequest } from "./restRequest.js";
import type { HarnessConfig } from "./config.js";
import type { LogEventInput } from "./logging.js";
import type { TraceCollector } from "./traceCollector.js";
import type { ReplayManifest, ReplayRequest, RunOutcome } from "./traceSchema.js";
import { FtpClient } from "./ftpClient.js";
import { createContractHealthMonitor } from "./health.js";

export type ReplayResult = {
  runId: string;
  startedAt: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  outcome: RunOutcome;
};

export async function runReplay(input: {
  manifest: ReplayManifest;
  config: HarnessConfig;
  traceCollector: TraceCollector;
  log: (event: LogEventInput) => void;
  dryRun: boolean;
}): Promise<ReplayResult> {
  const requests = [...input.manifest.requests].sort(
    (left, right) => left.launchedAtMs - right.launchedAtMs || left.globalSeq - right.globalSeq,
  );
  const startedAt = new Date().toISOString();
  const runId = `replay-${input.manifest.runSessionId}`;

  if (requests.length === 0) {
    return {
      runId,
      startedAt,
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      outcome: "completed",
    };
  }

  if (input.dryRun) {
    const t0 = requests[0].launchedAtMs;
    for (const request of requests) {
      const offset = request.launchedAtMs - t0;
      const label =
        request.protocol === "REST"
          ? `${request.method ?? "GET"} ${request.url ?? ""}`
          : (request.rawCommand ?? request.commandVerb ?? "FTP");
      process.stdout.write(
        `${String(request.globalSeq).padStart(4, " ")} +${offset}ms client=${request.clientId} ${request.protocol} ${label}\n`,
      );
    }
    return {
      runId,
      startedAt,
      totalRequests: requests.length,
      successCount: 0,
      failureCount: 0,
      outcome: "completed",
    };
  }

  const restClient = new RestClient({
    baseUrl: input.config.baseUrl,
    auth: input.config.auth,
    password: input.config.password,
    timeoutMs: input.config.timeouts.restTimeoutMs,
    keepAlive: input.config.http?.keepAlive ?? true,
    maxSockets: input.config.http?.maxSockets ?? 8,
  });
  const restRequest = createRestRequest(restClient, {
    mode: "STRESS",
    traceCollector: input.traceCollector,
    defaultClientId: "replay-rest-client",
  });
  const healthMonitor = createContractHealthMonitor(input.config);
  const ftpProbe = healthMonitor;
  const ftpSessions = new Map<string, Promise<FtpClient>>();
  const requestQueues = new Map<string, Promise<void>>();
  const pendingTimers = new Set<NodeJS.Timeout>();
  let successCount = 0;
  let failureCount = 0;
  let stopped = false;

  await assertReplayPreflight({ config: input.config, restRequest, ftpProbe });
  await cleanScratchDir(input.config);

  const t0 = requests[0].launchedAtMs;
  const completion = requests.map(
    (request) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            pendingTimers.delete(timer);
            const previous = requestQueues.get(request.clientId) ?? Promise.resolve();
            const next = previous
              .catch(() => undefined)
              .then(async () => {
                if (stopped) {
                  return;
                }
                try {
                  await executeReplayRequest({
                    request,
                    config: input.config,
                    restRequest,
                    ftpSessions,
                    log: input.log,
                  });
                  successCount += 1;
                  const assessment = await healthMonitor.check({
                    stageId: request.stageId,
                    source: `replay:${request.globalSeq}:post`,
                  });
                  if (assessment.abort) {
                    stopped = true;
                  }
                } catch (error) {
                  failureCount += 1;
                  const assessment = await healthMonitor.check({
                    stageId: request.stageId,
                    source: `replay:${request.globalSeq}:failure`,
                  });
                  stopped = assessment.abort;
                  input.log({
                    kind: "replay",
                    op: `seq-${request.globalSeq}`,
                    status: "error",
                    details: { message: String(error), healthState: assessment.state, reason: assessment.reason },
                  });
                }
              })
              .finally(resolve);
            requestQueues.set(request.clientId, next);
          },
          Math.max(0, request.launchedAtMs - t0),
        );
        pendingTimers.add(timer);
      }),
  );

  await Promise.all(completion);
  await Promise.all([...requestQueues.values()]);
  await Promise.all(
    [...ftpSessions.values()].map((sessionPromise) =>
      sessionPromise.then((client) =>
        client.close().catch((error) => {
          console.warn("Replay FTP close failed", { error: String(error) });
        }),
      ),
    ),
  );
  for (const timer of pendingTimers) {
    clearTimeout(timer);
  }

  return {
    runId,
    startedAt,
    totalRequests: requests.length,
    successCount,
    failureCount,
    outcome: stopped ? "device-unresponsive" : "completed",
  };
}

async function assertReplayPreflight(input: {
  config: HarnessConfig;
  restRequest: ReturnType<typeof createRestRequest>;
  ftpProbe: {
    check: (input: { source: string; stageId?: string }) => Promise<{ abort: boolean; state: string; reason: string }>;
  };
}): Promise<void> {
  const restResult = await input.restRequest({ method: "GET", url: "/v1/version" });
  if (restResult.status !== 200) {
    throw new Error(`Replay pre-flight REST probe failed: ${restResult.status}`);
  }
  const assessment = await input.ftpProbe.check({ source: "replay:preflight" });
  if (assessment.abort) {
    throw new Error(`Replay pre-flight health check failed: ${assessment.reason}`);
  }
}

async function cleanScratchDir(config: HarnessConfig): Promise<void> {
  const client = new FtpClient({
    host: new URL(config.baseUrl).hostname,
    port: config.ftpPort ?? 21,
    user: "anonymous",
    password: config.auth === "ON" ? config.password || "" : "",
    mode: config.ftpMode,
    timeoutMs: config.timeouts.ftpTimeoutMs,
  });
  try {
    await client.connect();
    await client.cwd(config.scratch.ftpDir).catch(async () => {
      await client.mkd(config.scratch.ftpDir);
      await client.cwd(config.scratch.ftpDir);
    });
    const listing = await client.nlst();
    const files = listing.data
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const file of files) {
      await client.dele(file).catch(() => undefined);
    }
  } finally {
    await client.close().catch((error) => {
      console.warn("Replay scratch cleanup close failed", { error: String(error) });
    });
  }
}

async function executeReplayRequest(input: {
  request: ReplayRequest;
  config: HarnessConfig;
  restRequest: ReturnType<typeof createRestRequest>;
  ftpSessions: Map<string, Promise<FtpClient>>;
  log: (event: LogEventInput) => void;
}): Promise<void> {
  if (input.request.protocol === "REST") {
    const response = await input.restRequest({
      method: input.request.method ?? "GET",
      url: toRelativeUrl(input.request.url ?? "", input.config.baseUrl),
      headers: input.request.headers,
      data: input.request.body,
      trace: { clientId: input.request.clientId },
    });
    input.log({
      kind: "replay",
      op: `${input.request.method ?? "GET"} ${input.request.url ?? ""}`,
      status: response.status,
      latencyMs: response.latencyMs,
      details: { globalSeq: input.request.globalSeq, clientId: input.request.clientId },
    });
    return;
  }

  const ftpSessionId = input.request.ftpSessionId ?? `replay-session-${input.request.clientId}`;
  const sessionPromise =
    input.ftpSessions.get(ftpSessionId) ??
    Promise.resolve().then(async () => {
      const client = new FtpClient({
        host: new URL(input.config.baseUrl).hostname,
        port: input.config.ftpPort ?? 21,
        user: "anonymous",
        password: input.config.auth === "ON" ? input.config.password || "" : "",
        mode: input.config.ftpMode,
        timeoutMs: input.config.timeouts.ftpTimeoutMs,
        clientId: input.request.clientId,
      });
      await client.connect();
      return client;
    });
  input.ftpSessions.set(ftpSessionId, sessionPromise);
  const client = await sessionPromise;
  client.setTraceClientId(input.request.clientId);
  await executeFtpReplayRequest(client, input.request, input.config);
}

async function executeFtpReplayRequest(
  client: FtpClient,
  request: ReplayRequest,
  config: HarnessConfig,
): Promise<void> {
  const rawCommand = request.rawCommand ?? request.commandVerb ?? "";
  const [verb, ...parts] = rawCommand.split(" ");
  const arg = parts.join(" ").trim();
  switch (verb.toUpperCase()) {
    case "LIST":
      await client.list(arg || "/");
      return;
    case "NLST":
      await client.nlst(arg || "/");
      return;
    case "MLSD":
      await client.mlsd(arg || "/");
      return;
    case "MLST":
      await client.mlst(arg || "/");
      return;
    case "PWD":
      await client.pwd();
      return;
    case "NOOP":
      await client.sendCommand("NOOP");
      return;
    case "RETR":
      await client.retr(arg);
      return;
    case "STOR":
      await client.cwd(config.scratch.ftpDir).catch(async () => {
        await client.mkd(config.scratch.ftpDir);
        await client.cwd(config.scratch.ftpDir);
      });
      await client.stor(arg, Buffer.alloc(request.byteCount ?? 0, replayFillByte(request.byteCount ?? 0)));
      return;
    default:
      await client.sendCommand(rawCommand);
  }
}

function replayFillByte(byteCount: number): number {
  return byteCount === 1024 ? 0x43 : 0x42;
}

function toRelativeUrl(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url, baseUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function buildReplayConfig(baseConfig: HarnessConfig, override: Partial<HarnessConfig>): HarnessConfig {
  return {
    ...baseConfig,
    baseUrl: override.baseUrl ?? baseConfig.baseUrl,
    auth: override.auth ?? baseConfig.auth,
    password: override.password ?? baseConfig.password,
    ftpMode: override.ftpMode ?? baseConfig.ftpMode,
    ftpPort: override.ftpPort ?? baseConfig.ftpPort,
    timeouts: override.timeouts ?? baseConfig.timeouts,
    trace: { enabled: true, level: "full" },
  };
}

export function createReplayLogCollector(runId: string): {
  log: (event: LogEventInput) => void;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    log: (event) => {
      lines.push(JSON.stringify({ runId, timestamp: new Date().toISOString(), ...event }));
    },
  };
}

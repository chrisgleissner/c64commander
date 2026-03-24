/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { promisify } from "node:util";
import type { HarnessConfig } from "./config.js";
import { FtpClient } from "./ftpClient.js";
import { delay } from "./timing.js";

const execFileAsync = promisify(execFile);
const DEFAULT_VERIFICATION_WINDOW_MS = 5_000;
const DEFAULT_VERIFICATION_BACKOFF_MS = [250, 500, 1_000];
const REQUIRED_PROTOCOLS: HealthProtocol[] = ["REST", "ICMP", "FTP"];

export type HealthProtocol = "REST" | "ICMP" | "FTP" | "TELNET";
export type HealthState = "HEALTHY" | "DEGRADED" | "UNRESPONSIVE";
export type ProbePhase = "baseline" | "verification";

export type ProbeResult = {
  protocol: HealthProtocol;
  ok: boolean;
  timestamp: string;
  status?: number | string;
  error?: string;
  latencyMs?: number;
};

export type ProbeBatch = {
  batchId: string;
  phase: ProbePhase;
  attempt: number;
  source: string;
  stageId?: string;
  timestamp: string;
  results: ProbeResult[];
};

export type HealthTransition = {
  from: HealthState | null;
  to: HealthState;
  timestamp: string;
  reason: string;
  source: string;
  stageId?: string;
};

export type ProtocolAvailabilityTransition = {
  protocol: HealthProtocol;
  from: boolean | null;
  to: boolean;
  timestamp: string;
  source: string;
  stageId?: string;
  reason: string;
};

export type HealthAssessment = {
  state: HealthState;
  abort: boolean;
  reason: string;
  batches: ProbeBatch[];
  latestBatch: ProbeBatch;
  availableProtocols: HealthProtocol[];
  unavailableProtocols: HealthProtocol[];
  transition?: HealthTransition;
};

export type HealthCheckContext = {
  source: string;
  stageId?: string;
};

export type ProbeFn = (input: {
  phase: ProbePhase;
  attempt: number;
  source: string;
  stageId?: string;
}) => Promise<ProbeResult>;

export type MultiProtocolHealthMonitorConfig = {
  verificationWindowMs?: number;
  verificationBackoffMs?: number[];
  requiredProtocols?: HealthProtocol[];
  onBatch?: (batch: ProbeBatch) => void;
  onTransition?: (transition: HealthTransition) => void;
  onProtocolTransition?: (transition: ProtocolAvailabilityTransition) => void;
};

export class MultiProtocolHealthMonitor {
  private currentState: HealthState | null = null;
  private readonly protocolAvailability = new Map<HealthProtocol, boolean>();
  private readonly verificationWindowMs: number;
  private readonly verificationBackoffMs: number[];
  private readonly requiredProtocols: HealthProtocol[];

  constructor(
    private readonly probes: ProbeFn[],
    private readonly config: MultiProtocolHealthMonitorConfig = {},
  ) {
    this.verificationWindowMs = config.verificationWindowMs ?? DEFAULT_VERIFICATION_WINDOW_MS;
    this.verificationBackoffMs = config.verificationBackoffMs ?? [...DEFAULT_VERIFICATION_BACKOFF_MS];
    this.requiredProtocols = config.requiredProtocols ?? REQUIRED_PROTOCOLS;
  }

  async check(context: HealthCheckContext): Promise<HealthAssessment> {
    const batches: ProbeBatch[] = [];
    const baseline = await this.runBatch({ phase: "baseline", attempt: 1, ...context });
    batches.push(baseline);

    let nextState: HealthState;
    let reason: string;

    if (this.isHealthy(baseline.results)) {
      nextState = "HEALTHY";
      reason = "All health probes succeeded.";
    } else {
      const verificationStartedAt = Date.now();
      let attempt = 1;
      while (Date.now() - verificationStartedAt < this.verificationWindowMs) {
        await delay(this.backoffForAttempt(attempt));
        attempt += 1;
        const batch = await this.runBatch({ phase: "verification", attempt, ...context });
        batches.push(batch);
      }
      if (batches.every((batch) => this.isRequiredUnavailable(batch.results))) {
        nextState = "UNRESPONSIVE";
        reason = `REST, ICMP, and FTP probes failed continuously for ${this.verificationWindowMs}ms.`;
      } else {
        nextState = "DEGRADED";
        reason = `Probe failures were transient or partial during the ${this.verificationWindowMs}ms verification window.`;
      }
    }

    const availability = summarizeProtocolAvailability(batches[batches.length - 1]?.results ?? baseline.results);

    const transition =
      this.currentState === nextState
        ? undefined
        : {
            from: this.currentState,
            to: nextState,
            timestamp: new Date().toISOString(),
            reason,
            source: context.source,
            stageId: context.stageId,
          };
    this.currentState = nextState;
    if (transition) {
      this.config.onTransition?.(transition);
    }

    return {
      state: nextState,
      abort: nextState === "UNRESPONSIVE",
      reason,
      batches,
      latestBatch: batches[batches.length - 1] ?? baseline,
      availableProtocols: availability.availableProtocols,
      unavailableProtocols: availability.unavailableProtocols,
      transition,
    };
  }

  private async runBatch(input: {
    phase: ProbePhase;
    attempt: number;
    source: string;
    stageId?: string;
  }): Promise<ProbeBatch> {
    const batch: ProbeBatch = {
      batchId: randomUUID(),
      phase: input.phase,
      attempt: input.attempt,
      source: input.source,
      stageId: input.stageId,
      timestamp: new Date().toISOString(),
      results: await Promise.all(this.probes.map((probe) => probe(input))),
    };
    this.emitProtocolTransitions(batch);
    this.config.onBatch?.(batch);
    return batch;
  }

  private emitProtocolTransitions(batch: ProbeBatch): void {
    for (const result of batch.results) {
      const previous = this.protocolAvailability.get(result.protocol) ?? null;
      if (previous === result.ok) {
        continue;
      }
      this.protocolAvailability.set(result.protocol, result.ok);
      this.config.onProtocolTransition?.({
        protocol: result.protocol,
        from: previous,
        to: result.ok,
        timestamp: result.timestamp,
        source: batch.source,
        stageId: batch.stageId,
        reason: result.ok
          ? `${result.protocol} is available again.`
          : `${result.protocol} is now unavailable: ${result.error ?? String(result.status ?? "probe failed")}`,
      });
    }
  }

  private isHealthy(results: ProbeResult[]): boolean {
    const resultsByProtocol = new Map(results.map((result) => [result.protocol, result]));
    return this.requiredProtocols.every((protocol) => resultsByProtocol.get(protocol)?.ok === true);
  }

  private isRequiredUnavailable(results: ProbeResult[]): boolean {
    const resultsByProtocol = new Map(results.map((result) => [result.protocol, result]));
    return this.requiredProtocols.every((protocol) => resultsByProtocol.get(protocol)?.ok === false);
  }

  private backoffForAttempt(attempt: number): number {
    return this.verificationBackoffMs[Math.min(attempt - 1, this.verificationBackoffMs.length - 1)] ?? 1_000;
  }
}

export function createContractHealthMonitor(
  config: HarnessConfig,
  options: Omit<MultiProtocolHealthMonitorConfig, "requiredProtocols"> = {},
): MultiProtocolHealthMonitor {
  return new MultiProtocolHealthMonitor(createContractHealthProbes(config), {
    ...options,
    requiredProtocols: REQUIRED_PROTOCOLS,
  });
}

export function createContractHealthProbes(config: HarnessConfig): ProbeFn[] {
  const host = new URL(config.baseUrl).hostname;
  return [
    createRestInfoProbe(config),
    createPingProbe(host, config.health.timeoutMs),
    createFtpProbe(config),
    createTelnetProbe(host, Math.min(config.health.timeoutMs, 1_000)),
  ];
}

export function createFtpHealthProbe(config: HarnessConfig): ProbeFn {
  return createFtpProbe(config);
}

function createRestInfoProbe(config: HarnessConfig): ProbeFn {
  const targetUrl = new URL("/v1/info", config.baseUrl).toString();
  return async () => {
    const startedAt = Date.now();
    const args = [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code} %{time_total}",
      "--connect-timeout",
      String(Math.max(1, Math.ceil(config.health.timeoutMs / 1_000))),
      "--max-time",
      String(Math.max(1, Math.ceil(config.health.timeoutMs / 1_000))),
    ];
    if (config.auth === "ON" && config.password) {
      args.push("-H", `X-Password: ${config.password}`);
    }
    args.push(targetUrl);

    try {
      const { stdout } = await execFileAsync("curl", args, {
        timeout: config.health.timeoutMs + 500,
        maxBuffer: 16 * 1024,
      });
      const [statusRaw, totalTimeRaw] = stdout.trim().split(/\s+/);
      const status = Number.parseInt(statusRaw ?? "0", 10);
      const latencyMs = Math.round(Number.parseFloat(totalTimeRaw ?? "0") * 1_000);
      return {
        protocol: "REST",
        ok: status === 200,
        timestamp: new Date().toISOString(),
        status,
        latencyMs: Number.isFinite(latencyMs) ? latencyMs : Date.now() - startedAt,
        error: status === 200 ? undefined : `curl returned HTTP ${status}`,
      } satisfies ProbeResult;
    } catch (error) {
      return {
        protocol: "REST",
        ok: false,
        timestamp: new Date().toISOString(),
        status: "curl-failed",
        latencyMs: Date.now() - startedAt,
        error: formatExecError(error),
      } satisfies ProbeResult;
    }
  };
}

function createPingProbe(host: string, timeoutMs: number): ProbeFn {
  return async () => {
    const startedAt = Date.now();
    try {
      const { stdout } = await execFileAsync(
        "ping",
        ["-c", "1", "-W", String(Math.max(1, Math.ceil(timeoutMs / 1_000))), host],
        {
          timeout: timeoutMs + 500,
          maxBuffer: 16 * 1024,
        },
      );
      const latencyMatch = stdout.match(/time[=<]([\d.]+)\s*ms/);
      return {
        protocol: "ICMP",
        ok: true,
        timestamp: new Date().toISOString(),
        status: 0,
        latencyMs: latencyMatch ? Math.round(Number.parseFloat(latencyMatch[1] ?? "0")) : Date.now() - startedAt,
      } satisfies ProbeResult;
    } catch (error) {
      return {
        protocol: "ICMP",
        ok: false,
        timestamp: new Date().toISOString(),
        status: "ping-failed",
        latencyMs: Date.now() - startedAt,
        error: formatExecError(error),
      } satisfies ProbeResult;
    }
  };
}

function createFtpProbe(config: HarnessConfig): ProbeFn {
  return async () => {
    const client = new FtpClient({
      host: new URL(config.baseUrl).hostname,
      port: config.ftpPort ?? 21,
      user: "anonymous",
      password: config.auth === "ON" ? config.password || "" : "",
      mode: config.ftpMode,
      timeoutMs: config.timeouts.ftpTimeoutMs,
    });
    const startedAt = Date.now();
    try {
      await client.connect();
      const response = await client.sendCommand("NOOP");
      return {
        protocol: "FTP",
        ok: response.response.code < 400,
        timestamp: new Date().toISOString(),
        status: response.response.code,
        latencyMs: Date.now() - startedAt,
        error: response.response.code < 400 ? undefined : response.response.message,
      } satisfies ProbeResult;
    } catch (error) {
      return {
        protocol: "FTP",
        ok: false,
        timestamp: new Date().toISOString(),
        status: "ftp-failed",
        latencyMs: Date.now() - startedAt,
        error: String(error),
      } satisfies ProbeResult;
    } finally {
      await client.close().catch((error) => {
        console.warn("FTP health probe close failed", { error: String(error) });
      });
    }
  };
}

function createTelnetProbe(host: string, timeoutMs: number): ProbeFn {
  return async () => {
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();
    const socket = new net.Socket();
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          socket.removeAllListeners();
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => {
          cleanup();
          resolve();
        });
        socket.once("timeout", () => {
          cleanup();
          reject(new Error(`Telnet timeout after ${timeoutMs}ms`));
        });
        socket.once("error", (error) => {
          cleanup();
          reject(error);
        });
        socket.connect(23, host);
      });
      return {
        protocol: "TELNET",
        ok: true,
        timestamp,
        status: 0,
        latencyMs: Date.now() - startedAt,
      } satisfies ProbeResult;
    } catch (error) {
      return {
        protocol: "TELNET",
        ok: false,
        timestamp,
        status: "telnet-failed",
        latencyMs: Date.now() - startedAt,
        error: String(error),
      } satisfies ProbeResult;
    } finally {
      socket.destroy();
    }
  };
}

function formatExecError(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }
  const stderr = "stderr" in error ? String(error.stderr ?? "") : "";
  const stdout = "stdout" in error ? String(error.stdout ?? "") : "";
  const message = "message" in error ? String(error.message ?? "") : String(error);
  return [stderr.trim(), stdout.trim(), message.trim()].filter(Boolean).join(" | ");
}

function summarizeProtocolAvailability(results: ProbeResult[]): {
  availableProtocols: HealthProtocol[];
  unavailableProtocols: HealthProtocol[];
} {
  const availableProtocols: HealthProtocol[] = [];
  const unavailableProtocols: HealthProtocol[] = [];
  for (const result of results) {
    if (result.ok) {
      availableProtocols.push(result.protocol);
    } else {
      unavailableProtocols.push(result.protocol);
    }
  }
  return { availableProtocols, unavailableProtocols };
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeReplayManifest, writeTraceMd } from "./traceWriter.js";
import type { TraceEntry } from "./traceSchema.js";

const tempDirs: string[] = [];

describe("traceWriter", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes markdown and replay artifacts without leaking x-password", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-writer-"));
    tempDirs.push(dir);
    const entries = buildTraceEntries();

    writeTraceMd(dir, entries);
    writeReplayManifest(dir, entries, "http://127.0.0.1:8080");

    const markdown = fs.readFileSync(path.join(dir, "trace.md"), "utf8");
    const shell = fs.readFileSync(path.join(dir, "replay", "device-replay.sh"), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "replay", "manifest.json"), "utf8")) as {
      requests: Array<{ protocol: string }>;
    };

    expect(markdown).toContain("## [1] REST GET /v1/version");
    expect(markdown).toContain("## [6] FTP LIST /");
    expect(shell).toContain('DEVICE_HOST="c64u"');
    expect(shell).toContain("--host <hostname>");
    expect(shell).toContain("lftp -u anonymous");
    expect(shell).toContain('HTTP_BASE_URL="http://${DEVICE_HOST}"');
    expect(shell).toContain("log_step");
    expect(shell).toContain("Embedded protocol degradation expectations");
    expect(shell).toContain("EXPECTED FTP DEGRADATION");
    expect(shell).toContain("EXPECTED PING DEGRADATION");
    expect(shell).toContain("EXPECTED TELNET DEGRADATION");
    expect(manifest.requests).toHaveLength(2);
  });
});

function buildTraceEntries(): TraceEntry[] {
  return [
    {
      globalSeq: 1,
      runSessionId: "run-1",
      correlationId: "corr-rest",
      clientId: "client-1",
      stageId: "stage-1",
      testType: "stress",
      timestamp: "2026-03-24T12:00:00.000Z",
      launchedAtMs: 1000,
      hrTimeNs: 1n,
      protocol: "REST",
      direction: "request",
      method: "GET",
      url: "http://127.0.0.1:8080/v1/version",
      headers: { "X-Correlation-Id": "corr-rest" },
      body: null,
    },
    {
      globalSeq: 2,
      runSessionId: "run-1",
      correlationId: "corr-rest",
      clientId: "client-1",
      stageId: "stage-1",
      testType: "stress",
      timestamp: "2026-03-24T12:00:00.010Z",
      launchedAtMs: 1000,
      hrTimeNs: 2n,
      protocol: "REST",
      direction: "response",
      status: 200,
      headers: { "content-type": "application/json" },
      body: { version: "3.14" },
      latencyMs: 10,
      bodyPreviewHex: "7b7d",
      bodyPreviewAscii: "{}",
    },
    {
      globalSeq: 3,
      runSessionId: "run-1",
      correlationId: "corr-health-ftp",
      clientId: "health-monitor",
      stageId: "stage-1",
      testType: "stress",
      timestamp: "2026-03-24T12:00:00.015Z",
      launchedAtMs: 1015,
      hrTimeNs: 9n,
      protocol: "HEALTH",
      direction: "probe",
      probeProtocol: "FTP",
      phase: "verification",
      attempt: 2,
      source: "spike-01:periodic",
      state: "DEGRADED",
      ok: false,
      status: "ftp-failed",
      error: "FTP failed",
      latencyMs: 5,
    },
    {
      globalSeq: 4,
      runSessionId: "run-1",
      correlationId: "corr-health-icmp",
      clientId: "health-monitor",
      stageId: "stage-1",
      testType: "stress",
      timestamp: "2026-03-24T12:00:00.017Z",
      launchedAtMs: 1017,
      hrTimeNs: 10n,
      protocol: "HEALTH",
      direction: "probe",
      probeProtocol: "ICMP",
      phase: "verification",
      attempt: 2,
      source: "spike-01:periodic",
      state: "DEGRADED",
      ok: false,
      status: "ping-failed",
      error: "Ping failed",
      latencyMs: 6,
    },
    {
      globalSeq: 5,
      runSessionId: "run-1",
      correlationId: "corr-health-telnet",
      clientId: "health-monitor",
      stageId: "stage-1",
      testType: "stress",
      timestamp: "2026-03-24T12:00:00.019Z",
      launchedAtMs: 1019,
      hrTimeNs: 11n,
      protocol: "HEALTH",
      direction: "probe",
      probeProtocol: "TELNET",
      phase: "verification",
      attempt: 2,
      source: "spike-01:periodic",
      state: "DEGRADED",
      ok: false,
      status: "telnet-failed",
      error: "Telnet failed",
      latencyMs: 7,
    },
    {
      globalSeq: 6,
      runSessionId: "run-1",
      correlationId: "corr-ftp",
      clientId: "client-2",
      stageId: "stage-1",
      testType: "stress",
      timestamp: "2026-03-24T12:00:00.020Z",
      launchedAtMs: 1020,
      hrTimeNs: 3n,
      protocol: "FTP",
      direction: "command",
      ftpSessionId: "ftp-1",
      rawCommand: "LIST /",
      commandVerb: "LIST",
    },
  ];
}

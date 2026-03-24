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
    expect(markdown).toContain("## [3] FTP LIST /");
    expect(shell.toLowerCase()).not.toContain("x-password: secret");
    expect(shell).toContain("# X-Password: SET_PASSWORD_HERE");
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

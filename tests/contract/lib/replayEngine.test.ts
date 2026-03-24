import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceCollector } from "./traceCollector.js";
import { runReplay } from "./replayEngine.js";
import type { HarnessConfig } from "./config.js";
import type { ReplayManifest } from "./traceSchema.js";

describe("runReplay dry-run", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the scheduled requests in launch order without making network calls", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const manifest: ReplayManifest = {
      runSessionId: "original-run",
      generatedAt: "2026-03-24T12:00:00.000Z",
      baseUrl: "http://127.0.0.1:8080",
      totalEntries: 3,
      requests: [
        {
          globalSeq: 2,
          protocol: "FTP",
          clientId: "client-2",
          launchedAtMs: 1500,
          rawCommand: "LIST /",
          commandVerb: "LIST",
        },
        {
          globalSeq: 1,
          protocol: "REST",
          clientId: "client-1",
          launchedAtMs: 1000,
          method: "GET",
          url: "http://127.0.0.1:8080/v1/version",
        },
      ],
    };

    const result = await runReplay({
      manifest,
      config: buildConfig(),
      traceCollector: new TraceCollector("replay-run"),
      log: () => undefined,
      dryRun: true,
    });

    expect(result.totalRequests).toBe(2);
    expect(writeSpy).toHaveBeenCalled();
    expect(writeSpy.mock.calls.map((call) => call[0]).join("")).toContain("1 +0ms client=client-1 REST GET http://127.0.0.1:8080/v1/version");
    expect(writeSpy.mock.calls.map((call) => call[0]).join("")).toContain("2 +500ms client=client-2 FTP LIST /");
  });
});

function buildConfig(): HarnessConfig {
  return {
    baseUrl: "http://127.0.0.1:8080",
    mode: "SAFE",
    auth: "OFF",
    password: "",
    ftpMode: "PASV",
    ftpPort: 21,
    outputDir: "test-results/contract",
    concurrency: {
      restMaxInFlight: 2,
      ftpMaxSessions: 2,
      mixedMaxInFlight: 2,
    },
    pacing: {
      restMinDelayMs: 10,
      ftpMinDelayMs: 10,
    },
    health: {
      endpoint: "/v1/version",
      intervalMs: 500,
      timeoutMs: 200,
    },
    timeouts: {
      restTimeoutMs: 500,
      ftpTimeoutMs: 500,
      scenarioTimeoutMs: 1000,
      maxDestructiveScenarioMs: 1000,
    },
    scratch: {
      ftpDir: "/Temp/contract-test",
    },
    allowMachineReset: false,
    trace: {
      enabled: true,
      level: "full",
    },
  };
}

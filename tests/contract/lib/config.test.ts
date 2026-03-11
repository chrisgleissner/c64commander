import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const tempDirs: string[] = [];

describe("contract config stressBreakpoint", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses a valid stress breakpoint profile for known SID volume targets", () => {
    const config = loadConfig(writeConfigFile(buildConfig()));
    expect(config.stressBreakpoint?.scenarioId).toBe("rest.breakpoint.sid-volume");
    expect(config.stressBreakpoint?.targets).toHaveLength(4);
  });

  it("rejects stressBreakpoint when mode is SAFE", () => {
    expect(() => loadConfig(writeConfigFile(buildConfig({ mode: "SAFE" })))).toThrow(
      /stressBreakpoint is only supported when mode is STRESS/,
    );
  });

  it("rejects unknown breakpoint targets", () => {
    const baseConfig = buildConfig();
    expect(() =>
      loadConfig(
        writeConfigFile(
          buildConfig({
            stressBreakpoint: {
              ...(baseConfig.stressBreakpoint as Record<string, unknown>),
              targets: [{ category: "Audio Mixer", item: "Vol Missing" }],
            },
          }),
        ),
      ),
    ).toThrow(/Unknown config target/);
  });
});

function writeConfigFile(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-config-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "config.json");
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  return filePath;
}

function buildConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    baseUrl: "http://127.0.0.1",
    mode: "STRESS",
    auth: "OFF",
    ftpMode: "PASV",
    ftpPort: 21,
    outputDir: "test-results/contract",
    concurrency: {
      restMaxInFlight: 3,
      ftpMaxSessions: 1,
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
    stressBreakpoint: {
      scenarioId: "rest.breakpoint.sid-volume",
      rateRampMs: [2000, 1000],
      concurrencyRamp: [1, 2, 4],
      stageDurationMs: 1000,
      failureDetectionTimeoutMs: 400,
      tailRequestCount: 10,
      targets: [
        { category: "Audio Mixer", item: "Vol Socket 1" },
        { category: "Audio Mixer", item: "Vol Socket 2" },
        { category: "Audio Mixer", item: "Vol UltiSid 1" },
        { category: "Audio Mixer", item: "Vol UltiSid 2" },
      ],
    },
    ...overrides,
  };
}

/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabStateStore } from "../src/labState.js";
import { createLogger } from "../src/logger.js";
import { ScopeSessionStore } from "../src/sessionStore.js";
import { captureModule } from "../src/tools/modules/capture.js";
import { catalogModule } from "../src/tools/modules/catalog.js";
import type { ToolExecutionContext, ToolRunResult } from "../src/tools/types.js";
import { captureAndAnalyzeStream } from "../src/stream/index.js";

vi.mock("../src/stream/index.js", () => ({
  captureAndAnalyzeStream: vi.fn(),
}));

function parseJsonText(result: ToolRunResult) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

async function createContext(): Promise<{ artifactRoot: string; ctx: ToolExecutionContext }> {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-tool-coverage-"));
  return {
    artifactRoot,
    ctx: {
      sessionStore: new ScopeSessionStore(artifactRoot),
      labStateStore: new LabStateStore(),
      logger: createLogger("scope-test"),
    },
  };
}

describe("catalog module", () => {
  it("lists cases, ready cases, selected case, and case evaluation", async () => {
    const { artifactRoot, ctx } = await createContext();

    try {
      const listResult = parseJsonText(await catalogModule.invoke("scope_catalog.list_cases", {}, ctx));
      expect(listResult.ok).toBe(true);
      expect(listResult.data.cases.length).toBeGreaterThan(0);

      const readyResult = parseJsonText(
        await catalogModule.invoke("scope_catalog.get_ready_cases", { completedCaseIds: ["nav-route-shell"] }, ctx),
      );
      expect(readyResult.ok).toBe(true);
      expect(Array.isArray(readyResult.data.readyCases)).toBe(true);
      expect(Array.isArray(readyResult.data.blockedCases)).toBe(true);
      expect(readyResult.data.testNamespaces).toBeDefined();

      const nextResult = parseJsonText(
        await catalogModule.invoke("scope_catalog.select_next_case", { completedCaseIds: ["nav-route-shell"] }, ctx),
      );
      expect(nextResult.ok).toBe(true);
      expect(nextResult.data.evaluation.status).toBe("ready");

      const knownCase = parseJsonText(
        await catalogModule.invoke("scope_catalog.evaluate_case", { caseId: "nav-route-shell" }, ctx),
      );
      expect(knownCase.ok).toBe(true);
      expect(knownCase.data.evaluation.caseId).toBe("nav-route-shell");
      expect(knownCase.data.evaluation.status).toBe("ready");

      const unknownCase = parseJsonText(
        await catalogModule.invoke("scope_catalog.evaluate_case", { caseId: "missing-case-id" }, ctx),
      );
      expect(unknownCase.ok).toBe(true);
      expect(unknownCase.data.evaluation.status).toBe("inconclusive");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

describe("capture module", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("handles reserve/start/stop/degrade lifecycle transitions", async () => {
    const { artifactRoot, ctx } = await createContext();

    try {
      const started = await ctx.sessionStore.startSession({ caseId: "TEST-CAPTURE-LIFECYCLE" });
      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("Failed to create lifecycle session");
      }

      const runId = started.runId;

      const reserved = parseJsonText(
        await captureModule.invoke(
          "scope_capture.reserve_capture",
          { runId, endpoints: ["udp://239.0.1.64:11000"] },
          ctx,
        ),
      );
      expect(reserved.ok).toBe(true);
      expect(reserved.data.captureStatus).toBe("reserved");

      const active = parseJsonText(await captureModule.invoke("scope_capture.start_capture", { runId }, ctx));
      expect(active.ok).toBe(true);
      expect(active.data.captureStatus).toBe("capturing");

      const stopped = parseJsonText(await captureModule.invoke("scope_capture.stop_capture", { runId }, ctx));
      expect(stopped.ok).toBe(true);
      expect(stopped.data.captureStatus).toBe("stopped");

      const secondSession = await ctx.sessionStore.startSession({ caseId: "TEST-CAPTURE-DEGRADE" });
      expect(secondSession.ok).toBe(true);
      if (!secondSession.ok) {
        throw new Error("Failed to create degrade session");
      }

      const degradeRunId = secondSession.runId;
      await captureModule.invoke("scope_capture.reserve_capture", { runId: degradeRunId }, ctx);

      const degraded = parseJsonText(
        await captureModule.invoke(
          "scope_capture.degrade_capture",
          { runId: degradeRunId, reason: "network timeout" },
          ctx,
        ),
      );
      expect(degraded.ok).toBe(false);
      expect(degraded.error.code).toBe("capture_degraded");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("captures a stream successfully and attaches evidence", async () => {
    const { artifactRoot, ctx } = await createContext();

    try {
      const started = await ctx.sessionStore.startSession({ caseId: "TEST-CAPTURE-SUCCESS" });
      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("Failed to create success session");
      }

      vi.mocked(captureAndAnalyzeStream).mockResolvedValue({
        capture: {
          streamType: "audio",
          durationMs: 1500,
          bindAddress: "0.0.0.0",
          bindPort: 11001,
          destination: "239.0.1.65:11001",
          packets: [{ receivedAtMs: 1, payload: Buffer.from([1, 2, 3]) }],
        },
        analysis: { rms: 0.12, dominantFrequencyHz: 440 },
        analysisPath: path.join(artifactRoot, "audio-analysis.json"),
        packetsPath: path.join(artifactRoot, "audio-packets.json"),
      });

      const result = parseJsonText(
        await captureModule.invoke(
          "scope_capture.capture_stream",
          {
            runId: started.runId,
            c64uHost: "c64u",
            streamType: "audio",
            durationMs: 1500,
          },
          ctx,
        ),
      );

      expect(result.ok).toBe(true);
      expect(result.data.streamType).toBe("audio");
      expect(result.data.packetCount).toBe(1);

      const summary = await ctx.sessionStore.getArtifactSummary(started.runId);
      expect(summary.ok).toBe(true);
      if (!summary.ok) {
        throw new Error("Missing artifact summary");
      }
      expect(summary.data.evidenceCount).toBe(1);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("degrades the capture when stream analysis fails", async () => {
    const { artifactRoot, ctx } = await createContext();

    try {
      const started = await ctx.sessionStore.startSession({ caseId: "TEST-CAPTURE-FAILURE" });
      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("Failed to create failure session");
      }

      vi.mocked(captureAndAnalyzeStream).mockRejectedValue(new Error("capture exploded"));

      const result = parseJsonText(
        await captureModule.invoke(
          "scope_capture.capture_stream",
          {
            runId: started.runId,
            c64uHost: "c64u",
            streamType: "video",
          },
          ctx,
        ),
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("capture_degraded");
      expect(result.error.message).toContain("capture exploded");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

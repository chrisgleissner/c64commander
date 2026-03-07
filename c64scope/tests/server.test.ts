import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createScopeServerRuntime } from "../src/server.js";
import type { ToolRunResult } from "../src/tools/types.js";

function parseToolText(result: ToolRunResult) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

describe("c64scope server skeleton", () => {
  it("registers the required tool groups, resources, and prompts", () => {
    const runtime = createScopeServerRuntime();
    const toolNames = runtime.toolRegistry.list().map((tool) => tool.name);

    expect(toolNames).toContain("scope_session.start_session");
    expect(toolNames).toContain("scope_lab.get_lab_state");
    expect(toolNames).toContain("scope_capture.reserve_capture");
    expect(toolNames).toContain("scope_assert.record_assertion");
    expect(toolNames).toContain("scope_artifact.get_artifact_summary");
    expect(toolNames).toContain("scope_catalog.list_cases");
    expect(runtime.listResources()).toHaveLength(5);
    expect(runtime.promptRegistry.list()).toHaveLength(1);
  });

  it("persists a session lifecycle and summary artifacts", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-"));
    const runtime = createScopeServerRuntime({ artifactRoot });

    try {
      const startResult = await runtime.toolRegistry.invoke("scope_session.start_session", {
        caseId: "mixed-format-playback",
      });
      const startPayload = parseToolText(startResult);
      const runId = startPayload.runId as string;
      const artifactDir = startPayload.data.artifactDir as string;

      await runtime.toolRegistry.invoke("scope_session.record_step", {
        runId,
        stepId: "step-1",
        route: "/play",
        featureArea: "Play",
        action: "Start playback through the app",
        primaryOracle: "UI plus A/V",
      });
      await runtime.toolRegistry.invoke("scope_capture.reserve_capture", { runId });
      await runtime.toolRegistry.invoke("scope_capture.start_capture", { runId });
      await runtime.toolRegistry.invoke("scope_assert.record_assertion", {
        runId,
        assertionId: "playback-start-visible",
        title: "Playback started",
        oracleClass: "A/V signal",
        passed: true,
      });
      await runtime.toolRegistry.invoke("scope_session.finalize_session", {
        runId,
        outcome: "pass",
        failureClass: "product_failure",
        summary: "Skeleton session finalized for contract validation.",
      });

      const sessionJson = JSON.parse(await readFile(path.join(artifactDir, "session.json"), "utf8"));
      const summary = await readFile(path.join(artifactDir, "summary.md"), "utf8");

      expect(sessionJson.runId).toBe(runId);
      expect(sessionJson.timeline).toHaveLength(1);
      expect(sessionJson.assertions).toHaveLength(1);
      expect(sessionJson.capture.status).toBe("capturing");
      expect(summary).toContain("Skeleton session finalized for contract validation.");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

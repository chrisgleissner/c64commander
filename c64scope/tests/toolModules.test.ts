import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPhysicalTestDevice } from "../src/deviceRegistry.js";
import { LabStateStore } from "../src/labState.js";
import { createLogger } from "../src/logger.js";
import { ScopeSessionStore } from "../src/sessionStore.js";
import { createToolRegistry } from "../src/toolsRegistry.js";

function parseJsonText(result: { content: readonly { text: string }[] }) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

describe("tool modules", () => {
  it("invokes lab, catalog, assertion, and artifact tools through the registry", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-tools-"));
    const sessionStore = new ScopeSessionStore(artifactRoot);
    const labStateStore = new LabStateStore();
    const toolRegistry = createToolRegistry({ sessionStore, labStateStore, logger: createLogger("scope-test") });

    try {
      // Lab state with no peer health reports → all unknown, not ready
      const labDefault = parseJsonText(await toolRegistry.invoke("scope_lab.get_lab_state", {}));
      expect(labDefault.data.ready).toBe(false);
      expect(labDefault.data.degradedReasons.length).toBe(3);

      // Report all peers healthy
      await toolRegistry.invoke("scope_lab.report_peer_health", {
        peer: "mobile_controller",
        level: "healthy",
        detail: `Device ${defaultPhysicalTestDevice.serialPrefix}... online`,
      });
      await toolRegistry.invoke("scope_lab.report_peer_health", {
        peer: "c64bridge",
        level: "healthy",
        detail: "REST responding",
      });
      await toolRegistry.invoke("scope_lab.report_peer_health", {
        peer: "capture_infrastructure",
        level: "healthy",
        detail: "Multicast configured",
      });

      const labHealthy = parseJsonText(await toolRegistry.invoke("scope_lab.get_lab_state", {}));
      expect(labHealthy.data.ready).toBe(true);
      expect(labHealthy.data.degradedReasons).toHaveLength(0);

      // Check readiness tool
      const readiness = parseJsonText(await toolRegistry.invoke("scope_lab.check_lab_readiness", {}));
      expect(readiness.data.ready).toBe(true);

      // Existing catalog/assertion/artifact tools
      const catalog = parseJsonText(await toolRegistry.invoke("scope_catalog.list_cases", {}));
      const assertions = parseJsonText(await toolRegistry.invoke("scope_assert.list_assertions", {}));
      const evidenceTypes = parseJsonText(await toolRegistry.invoke("scope_assert.list_evidence_types", {}));
      const missingArtifact = parseJsonText(
        await toolRegistry.invoke("scope_artifact.get_artifact_summary", { runId: "missing-run" }),
      );

      expect(catalog.data.cases.length).toBeGreaterThanOrEqual(20);
      expect(assertions.data.assertions.length).toBeGreaterThanOrEqual(10);
      expect(evidenceTypes.data.evidenceTypes.length).toBeGreaterThanOrEqual(8);
      expect(missingArtifact.ok).toBe(false);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

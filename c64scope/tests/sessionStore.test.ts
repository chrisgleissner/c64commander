import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScopeSessionStore } from "../src/sessionStore.js";

describe("ScopeSessionStore", () => {
  it("handles session lifecycle error paths and evidence attachment", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-session-"));
    const store = new ScopeSessionStore(artifactRoot);

    try {
      const missing = await store.getArtifactSummary("missing-run");
      expect(missing.ok).toBe(false);

      const started = await store.startSession({
        caseId: "route-shell-readonly",
        captureEndpoints: ["udp://239.0.0.1:1234"],
      });
      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("expected started session");
      }

      const runId = started.runId;
      const artifactDir = started.data.artifactDir;

      const stopBeforeStart = await store.stopCapture(runId);
      expect(stopBeforeStart.ok).toBe(false);

      const reserved = await store.reserveCapture({ runId, endpoints: ["udp://239.0.0.2:1234"] });
      expect(reserved.ok).toBe(true);

      const startedCapture = await store.startCapture(runId);
      expect(startedCapture.ok).toBe(true);

      const startAgain = await store.startCapture(runId);
      expect(startAgain.ok).toBe(false);

      const attached = await store.attachEvidence({
        runId,
        evidenceId: "e-1",
        evidenceType: "screenshot",
        summary: "Captured screenshot",
        metadata: { path: "/tmp/evidence.png" },
      });
      expect(attached.ok).toBe(true);

      const recorded = await store.recordAssertion({
        runId,
        assertionId: "a-1",
        title: "Assertion",
        oracleClass: "UI",
        passed: false,
        details: { reason: "mismatch" },
      });
      expect(recorded.ok).toBe(true);

      const stopped = await store.stopCapture(runId);
      expect(stopped.ok).toBe(true);

      const finalized = await store.finalizeSession({
        runId,
        outcome: "inconclusive",
        failureClass: "inconclusive",
        summary: "No deterministic result",
      });
      expect(finalized.ok).toBe(true);

      const afterClose = await store.recordStep({
        runId,
        stepId: "late-step",
        route: "/",
        featureArea: "Home",
        action: "Late write",
        primaryOracle: "UI",
      });
      expect(afterClose.ok).toBe(false);

      const sessionJson = JSON.parse(await readFile(path.join(artifactDir, "session.json"), "utf8"));
      const summary = await readFile(path.join(artifactDir, "summary.md"), "utf8");

      expect(sessionJson.evidence).toHaveLength(1);
      expect(sessionJson.assertions).toHaveLength(1);
      expect(sessionJson.capture.status).toBe("stopped");
      expect(summary).toContain("No deterministic result");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("covers default capture endpoints and open-session summaries", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-session-defaults-"));
    const store = new ScopeSessionStore(artifactRoot);
    const customArtifactDir = path.join(artifactRoot, "custom-artifacts");

    try {
      const started = await store.startSession({
        caseId: "settings-diagnostics-persistence",
        artifactDir: customArtifactDir,
      });
      expect(started.ok).toBe(true);
      if (!started.ok) {
        throw new Error("expected started session");
      }

      const openSummary = await store.getArtifactSummary(started.runId);
      expect(openSummary.ok).toBe(true);
      if (!openSummary.ok) {
        throw new Error("expected open summary");
      }
      expect(openSummary.data.outcome).toBeNull();
      expect(openSummary.data.summary).toBeNull();

      const reserved = await store.reserveCapture({ runId: started.runId });
      expect(reserved.ok).toBe(true);
      if (!reserved.ok) {
        throw new Error("expected reserved capture");
      }
      expect(reserved.data.endpoints).toEqual(["udp://239.0.0.64:11064"]);

      const attached = await store.attachEvidence({
        runId: started.runId,
        evidenceId: "e-defaults",
        evidenceType: "log",
        summary: "Default metadata path",
      });
      expect(attached.ok).toBe(true);

      const missingReserve = await store.reserveCapture({ runId: "missing-run" });
      const missingStart = await store.startCapture("missing-run");
      const missingStop = await store.stopCapture("missing-run");
      const missingAttach = await store.attachEvidence({
        runId: "missing-run",
        evidenceId: "missing-evidence",
        evidenceType: "log",
        summary: "missing",
      });
      const missingAssertion = await store.recordAssertion({
        runId: "missing-run",
        assertionId: "missing-assertion",
        title: "Missing",
        oracleClass: "UI",
        passed: false,
      });
      const missingFinalize = await store.finalizeSession({
        runId: "missing-run",
        outcome: "fail",
        failureClass: "inconclusive",
        summary: "missing",
      });

      expect(missingReserve.ok).toBe(false);
      expect(missingStart.ok).toBe(false);
      expect(missingStop.ok).toBe(false);
      expect(missingAttach.ok).toBe(false);
      expect(missingAssertion.ok).toBe(false);
      expect(missingFinalize.ok).toBe(false);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

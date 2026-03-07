/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LabStateStore } from "../src/labState.js";
import { ScopeSessionStore } from "../src/sessionStore.js";
import { evidenceTypeCatalog } from "../src/catalog/index.js";

describe("LabStateStore", () => {
  it("returns unknown for unreported peers", () => {
    const store = new LabStateStore();
    const health = store.getPeerHealth("mobile_controller");
    expect(health.peer).toBe("mobile_controller");
    expect(health.level).toBe("unknown");
    expect(health.detail).toBe("No health report received.");
  });

  it("tracks reported peer health", () => {
    const store = new LabStateStore();
    const report = store.reportPeerHealth("c64bridge", "healthy", "REST responding on 192.168.1.13");
    expect(report.peer).toBe("c64bridge");
    expect(report.level).toBe("healthy");
    expect(report.detail).toContain("192.168.1.13");
    expect(report.reportedAt).toBeTruthy();

    const retrieved = store.getPeerHealth("c64bridge");
    expect(retrieved.level).toBe("healthy");
  });

  it("updates health on subsequent reports", () => {
    const store = new LabStateStore();
    store.reportPeerHealth("mobile_controller", "healthy", "Device online");
    store.reportPeerHealth("mobile_controller", "degraded", "Device locked");
    expect(store.getPeerHealth("mobile_controller").level).toBe("degraded");
  });

  it("checks readiness with all healthy peers", () => {
    const store = new LabStateStore();
    store.reportPeerHealth("mobile_controller", "healthy", "OK");
    store.reportPeerHealth("c64bridge", "healthy", "OK");
    store.reportPeerHealth("capture_infrastructure", "healthy", "OK");

    const readiness = store.checkReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.degradedReasons).toHaveLength(0);
  });

  it("reports not ready when any peer is unavailable", () => {
    const store = new LabStateStore();
    store.reportPeerHealth("mobile_controller", "healthy", "OK");
    store.reportPeerHealth("c64bridge", "unavailable", "Timed out");
    store.reportPeerHealth("capture_infrastructure", "healthy", "OK");

    const readiness = store.checkReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.degradedReasons).toHaveLength(1);
    expect(readiness.degradedReasons[0]).toContain("c64bridge");
    expect(readiness.degradedReasons[0]).toContain("unavailable");
  });

  it("reports not ready when peers are unreported (unknown)", () => {
    const store = new LabStateStore();
    const readiness = store.checkReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.degradedReasons).toHaveLength(3);
  });

  it("includes degraded peers in reasons", () => {
    const store = new LabStateStore();
    store.reportPeerHealth("mobile_controller", "degraded", "Locked");
    store.reportPeerHealth("c64bridge", "healthy", "OK");
    store.reportPeerHealth("capture_infrastructure", "degraded", "Partial");

    const readiness = store.checkReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.degradedReasons).toHaveLength(2);
  });

  it("resets clears all peer health", () => {
    const store = new LabStateStore();
    store.reportPeerHealth("c64bridge", "healthy", "OK");
    store.reset();
    expect(store.getPeerHealth("c64bridge").level).toBe("unknown");
  });
});

describe("capture degradation", () => {
  it("degrades a reserved capture", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-degrade-"));
    const store = new ScopeSessionStore(artifactRoot);

    try {
      const started = await store.startSession({
        caseId: "nav-route-shell",
      });
      expect(started.ok).toBe(true);
      if (!started.ok) throw new Error("expected started");
      const runId = started.runId;

      const reserved = await store.reserveCapture({ runId });
      expect(reserved.ok).toBe(true);

      const degraded = await store.degradeCapture(runId, "Multicast endpoint unreachable");
      expect(degraded.ok).toBe(false);
      if (degraded.ok) throw new Error("expected error");
      expect(degraded.error.code).toBe("capture_degraded");
      expect(degraded.error.message).toContain("unreachable");
      expect(degraded.error.details.captureStatus).toBe("stopped");

      const sessionJson = JSON.parse(
        await readFile(path.join(started.data.artifactDir as string, "session.json"), "utf8"),
      );
      expect(sessionJson.capture.status).toBe("stopped");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("degrades an active (capturing) capture", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-degrade-active-"));
    const store = new ScopeSessionStore(artifactRoot);

    try {
      const started = await store.startSession({
        caseId: "nav-route-shell",
      });
      if (!started.ok) throw new Error("expected started");
      const runId = started.runId;

      await store.reserveCapture({ runId });
      await store.startCapture(runId);

      const degraded = await store.degradeCapture(runId, "Audio stream dropped");
      expect(degraded.ok).toBe(false);
      if (degraded.ok) throw new Error("expected error");
      expect(degraded.error.code).toBe("capture_degraded");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("rejects degradation on idle capture", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-degrade-idle-"));
    const store = new ScopeSessionStore(artifactRoot);

    try {
      const started = await store.startSession({
        caseId: "nav-route-shell",
      });
      if (!started.ok) throw new Error("expected started");

      const result = await store.degradeCapture(started.runId, "Should not work");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("capture_unavailable");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("rejects degradation on missing session", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-degrade-missing-"));
    const store = new ScopeSessionStore(artifactRoot);

    try {
      const result = await store.degradeCapture("nonexistent", "Should fail");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("session_not_found");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

describe("evidence type catalog", () => {
  it("defines all required evidence types", () => {
    const expectedTypes = [
      "screenshot",
      "diagnostics_export",
      "logcat",
      "rest_snapshot",
      "ftp_snapshot",
      "state_ref",
      "config_snapshot",
      "trace_export",
      "stream_capture",
    ];
    const catalogTypes = evidenceTypeCatalog.map((e) => e.type);
    for (const type of expectedTypes) {
      expect(catalogTypes).toContain(type);
    }
  });

  it("has valid oracle class for each type", () => {
    for (const entry of evidenceTypeCatalog) {
      expect(entry.oracleClass).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(Array.isArray(entry.requiredMetadata)).toBe(true);
    }
  });

  it("requires metadata for types that need context", () => {
    const restSnapshot = evidenceTypeCatalog.find((e) => e.type === "rest_snapshot");
    expect(restSnapshot?.requiredMetadata).toContain("endpoint");

    const ftpSnapshot = evidenceTypeCatalog.find((e) => e.type === "ftp_snapshot");
    expect(ftpSnapshot?.requiredMetadata).toContain("remotePath");

    const stateRef = evidenceTypeCatalog.find((e) => e.type === "state_ref");
    expect(stateRef?.requiredMetadata).toContain("stateKey");

    const streamCapture = evidenceTypeCatalog.find((e) => e.type === "stream_capture");
    expect(streamCapture?.requiredMetadata).toContain("streamType");

    const configSnapshot = evidenceTypeCatalog.find((e) => e.type === "config_snapshot");
    expect(configSnapshot?.requiredMetadata).toContain("snapshotName");
  });

  it("does not require extra metadata for simple capture types", () => {
    for (const simpleType of ["screenshot", "diagnostics_export", "logcat", "trace_export"]) {
      const entry = evidenceTypeCatalog.find((e) => e.type === simpleType);
      expect(entry?.requiredMetadata).toHaveLength(0);
    }
  });
});

describe("evidence attachment with capture lifecycle dry run", () => {
  it("exercises full capture + evidence + assertion session", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-obs-dryrun-"));
    const store = new ScopeSessionStore(artifactRoot);

    try {
      const session = await store.startSession({
        caseId: "play-transport-playback",
        captureEndpoints: ["udp://239.0.0.64:11064"],
      });
      if (!session.ok) throw new Error("expected started");
      const runId = session.runId;
      const artifactDir = session.data.artifactDir as string;

      await store.recordStep({
        runId,
        stepId: "step-1",
        route: "/play",
        featureArea: "Play",
        action: "Navigate to Play tab",
        primaryOracle: "UI",
      });

      await store.reserveCapture({ runId });
      await store.startCapture(runId);

      await store.attachEvidence({
        runId,
        evidenceId: "ev-screenshot-1",
        stepId: "step-1",
        evidenceType: "screenshot",
        summary: "Play tab visible with source list",
        path: "/tmp/screenshot-1.png",
      });

      await store.attachEvidence({
        runId,
        evidenceId: "ev-rest-1",
        evidenceType: "rest_snapshot",
        summary: "C64U /v1/machine status response",
        metadata: { endpoint: "/v1/machine", statusCode: 200 },
      });

      await store.attachEvidence({
        runId,
        evidenceId: "ev-logcat-1",
        evidenceType: "logcat",
        summary: "SID playback started log entry",
        metadata: { tag: "SidPlayer", level: "INFO" },
      });

      await store.stopCapture(runId);

      await store.recordAssertion({
        runId,
        assertionId: "assert-1",
        title: "Play tab shows source list",
        oracleClass: "UI",
        passed: true,
      });

      await store.recordAssertion({
        runId,
        assertionId: "assert-2",
        title: "REST machine state is running",
        oracleClass: "REST-visible state",
        passed: true,
        details: { endpoint: "/v1/machine", state: "running" },
      });

      const finalized = await store.finalizeSession({
        runId,
        outcome: "pass",
        failureClass: "product_failure",
        summary: "All playback observations confirmed.",
      });
      expect(finalized.ok).toBe(true);

      const sessionJson = JSON.parse(await readFile(path.join(artifactDir, "session.json"), "utf8"));
      expect(sessionJson.timeline).toHaveLength(1);
      expect(sessionJson.evidence).toHaveLength(3);
      expect(sessionJson.assertions).toHaveLength(2);
      expect(sessionJson.capture.status).toBe("stopped");
      expect(sessionJson.outcome).toBe("pass");

      const evidenceTypes = sessionJson.evidence.map((e: { evidenceType: string }) => e.evidenceType);
      expect(evidenceTypes).toContain("screenshot");
      expect(evidenceTypes).toContain("rest_snapshot");
      expect(evidenceTypes).toContain("logcat");

      const summaryMd = await readFile(path.join(artifactDir, "summary.md"), "utf8");
      expect(summaryMd).toContain("Evidence items: 3");
      expect(summaryMd).toContain("Assertions: 2");
      expect(summaryMd).toContain("Outcome: pass");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

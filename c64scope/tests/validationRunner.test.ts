/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const adbMock = vi.fn();
const c64uGetMock = vi.fn();
const resetC64MachineMock = vi.fn();

vi.mock("../src/validation/helpers.js", () => ({
  adb: adbMock,
  c64uGet: c64uGetMock,
  resetC64Machine: resetC64MachineMock,
}));

afterEach(() => {
  vi.doUnmock("../src/sessionStore.js");
});

describe("validation runner", () => {
  it("collects hardware info from helpers", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(JSON.stringify({ product: "Ultimate 64" }));

    const { collectHardwareInfo } = await import("../src/validation/runner.js");
    const info = await collectHardwareInfo("serial-1", "c64u");

    expect(info.hwModel).toBe("Pixel");
    expect(info.hwType).toBe("tensor");
    expect(info.hwChars).toBe("phone");
    expect(info.osVersion).toBe("14");
    expect(info.c64uInfo.product).toBe("Ultimate 64");
  });

  it("runs a product-track case, writes artifacts, and flags product-policy violations", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(
      JSON.stringify({
        hostname: "c64u",
        firmware_version: "1.0",
        product: "Ultimate 64",
        unique_id: "abc",
      }),
    );
    resetC64MachineMock.mockResolvedValue(undefined);

    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-runner-"));
    const { runCase } = await import("../src/validation/runner.js");

    try {
      const result = await runCase(
        {
          id: "TEST-CASE",
          name: "Runner Case",
          caseId: "RUN-001",
          featureArea: "Play",
          route: "/play",
          validationTrack: "product",
          safetyClass: "guarded-mutation",
          expectedOutcome: "pass",
          oracleClasses: ["UI", "REST-visible state"],
          run: async (ctx) => {
            await ctx.store.recordStep({
              runId: ctx.runId,
              stepId: "step-01",
              route: "/play",
              featureArea: "Play",
              action: "direct mount",
              peerServer: "c64bridge",
              primaryOracle: "UI",
              bridgeFallbackCategory: "app_path_unavailable",
              bridgeFallbackJustification: "Needed because app path was unavailable",
            });
            return {
              assertions: [
                { oracleClass: "UI", passed: true, details: {} },
                { oracleClass: "REST-visible state", passed: true, details: {} },
              ],
              explorationTrace: {
                routeDiscovery: ["/play"],
                decisionLog: [],
                safetyBudget: "guarded-mutation",
                oracleSelection: ["UI", "REST-visible state"],
                recoveryActions: [],
              },
            };
          },
        },
        "serial-1",
        "c64u",
        artifactRoot,
      );

      expect(result.outcome).toBe("fail");
      expect(result.failureClass).toBe("infrastructure_failure");
      expect(result.artifacts).toContain("session.json");
      expect(result.artifacts).toContain("llm-decision-trace.json");
      expect(result.artifacts).toContain("hardware-proof.json");
      expect(
        JSON.parse(await readFile(path.join(result.artifactDir, "llm-decision-trace.json"), "utf-8")),
      ).toMatchObject({
        caseId: "RUN-001",
        peerServersUsed: ["c64bridge"],
      });
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("marks a case failed when execution aborts or reset fails", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(
      JSON.stringify({
        hostname: "c64u",
        firmware_version: "1.0",
        product: "Ultimate 64",
        unique_id: "abc",
      }),
    );
    resetC64MachineMock.mockRejectedValue(new Error("reset broke"));

    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-runner-fail-"));
    const { runCase } = await import("../src/validation/runner.js");

    try {
      const result = await runCase(
        {
          id: "TEST-FAIL",
          name: "Runner Failure Case",
          caseId: "RUN-002",
          featureArea: "Home",
          route: "/",
          validationTrack: "calibration",
          safetyClass: "read-only",
          expectedOutcome: "fail",
          oracleClasses: ["UI", "A/V signal"],
          run: async () => {
            throw new Error("execution exploded");
          },
        },
        "serial-1",
        "c64u",
        artifactRoot,
      );

      expect(result.outcome).toBe("fail");
      expect(result.failureClass).toBe("infrastructure_failure");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("records a plain abort summary when execution fails but the recovery reset succeeds", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(
      JSON.stringify({
        hostname: "c64u",
        firmware_version: "1.0",
        product: "Ultimate 64",
        unique_id: "abc",
      }),
    );
    resetC64MachineMock.mockResolvedValue(undefined);

    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-runner-abort-"));
    const { runCase } = await import("../src/validation/runner.js");

    try {
      const result = await runCase(
        {
          id: "TEST-ABORT",
          name: "Runner Abort Case",
          caseId: "RUN-002B",
          featureArea: "Home",
          route: "/",
          validationTrack: "calibration",
          safetyClass: "read-only",
          expectedOutcome: "fail",
          oracleClasses: ["UI"],
          run: async () => {
            throw new Error("execution aborted cleanly");
          },
        },
        "serial-1",
        "c64u",
        artifactRoot,
      );

      const session = JSON.parse(await readFile(path.join(result.artifactDir, "session.json"), "utf-8")) as {
        summary: string;
      };

      expect(result.outcome).toBe("fail");
      expect(session.summary).toContain("Case aborted: execution aborted cleanly");
      expect(session.summary).not.toContain("reset failed");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("preserves a passing non-product run and records c64scope peer usage from evidence", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(
      JSON.stringify({
        hostname: "c64u",
        firmware_version: "1.0",
        product: "Ultimate 64",
        unique_id: "abc",
      }),
    );
    resetC64MachineMock.mockResolvedValue(undefined);

    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-runner-pass-"));
    const { runCase } = await import("../src/validation/runner.js");

    try {
      const result = await runCase(
        {
          id: "TEST-PASS",
          name: "Runner Pass Case",
          caseId: "RUN-003",
          featureArea: "Docs",
          route: "/docs",
          validationTrack: "calibration",
          safetyClass: "read-only",
          expectedOutcome: "pass",
          oracleClasses: ["UI", "A/V signal"],
          run: async (ctx) => {
            await ctx.store.attachEvidence({
              runId: ctx.runId,
              evidenceId: "ev-1",
              evidenceType: "screenshot",
              summary: "screen",
            });
            await ctx.store.recordAssertion({
              runId: ctx.runId,
              assertionId: "assert-01",
              title: "ok",
              oracleClass: "UI",
              passed: true,
              details: {},
            });
            await ctx.store.recordAssertion({
              runId: ctx.runId,
              assertionId: "assert-02",
              title: "ok",
              oracleClass: "A/V signal",
              passed: true,
              details: {},
            });
            return {
              assertions: [
                { oracleClass: "UI", passed: true, details: {} },
                { oracleClass: "A/V signal", passed: true, details: {} },
              ],
              explorationTrace: {
                routeDiscovery: ["/docs"],
                decisionLog: [],
                safetyBudget: "read-only",
                oracleSelection: ["UI", "A/V signal"],
                recoveryActions: [],
              },
            };
          },
        },
        "serial-1",
        "c64u",
        artifactRoot,
      );

      expect(result.outcome).toBe("pass");
      expect(
        JSON.parse(await readFile(path.join(result.artifactDir, "llm-decision-trace.json"), "utf-8")).peerServersUsed,
      ).toContain("c64scope");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("fails a product run when bridge fallback metadata is missing after a successful case", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(
      JSON.stringify({
        hostname: "c64u",
        firmware_version: "1.0",
        product: "Ultimate 64",
        unique_id: "abc",
      }),
    );
    resetC64MachineMock.mockRejectedValueOnce(new Error("reset broke after success"));

    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-runner-policy-"));
    const { runCase } = await import("../src/validation/runner.js");

    try {
      const result = await runCase(
        {
          id: "TEST-POLICY",
          name: "Runner Policy Case",
          caseId: "RUN-004",
          featureArea: "Play",
          route: "/play",
          validationTrack: "product",
          safetyClass: "guarded-mutation",
          expectedOutcome: "pass",
          oracleClasses: ["UI", "REST-visible state"],
          run: async (ctx) => {
            const stepResult = await ctx.store.recordStep({
              runId: ctx.runId,
              stepId: "step-01",
              route: "/play",
              featureArea: "Play",
              action: "inspect_state",
              peerServer: "c64bridge",
              primaryOracle: "REST-visible state",
              bridgeFallbackCategory: "app_path_unavailable",
              bridgeFallbackJustification: "The app route was unavailable for this inspection",
            });
            expect(stepResult.ok).toBe(true);
            const sessionPath = path.join(ctx.artifactDir, "session.json");
            const session = JSON.parse(await readFile(sessionPath, "utf-8")) as {
              timeline: Array<{
                bridgeFallbackCategory: string | null;
                bridgeFallbackJustification: string | null;
              }>;
            };
            session.timeline[0]!.bridgeFallbackCategory = null;
            session.timeline[0]!.bridgeFallbackJustification = null;
            await writeFile(sessionPath, JSON.stringify(session, null, 2), "utf-8");
            return {
              assertions: [
                { oracleClass: "UI", passed: true, details: {} },
                { oracleClass: "REST-visible state", passed: true, details: {} },
              ],
              explorationTrace: {
                routeDiscovery: ["/play"],
                decisionLog: [],
                safetyBudget: "guarded-mutation",
                oracleSelection: ["UI", "REST-visible state"],
                recoveryActions: [],
              },
            };
          },
        },
        "serial-1",
        "c64u",
        artifactRoot,
      );

      expect(result.outcome).toBe("fail");
      expect(result.failureClass).toBe("infrastructure_failure");
      expect(result.explorationTrace.recoveryActions.join(" ")).toContain("missing bridge fallback category");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("ignores non-c64bridge and incomplete timeline entries during product policy scans", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(
      JSON.stringify({
        hostname: "c64u",
        firmware_version: "1.0",
        product: "Ultimate 64",
        unique_id: "abc",
      }),
    );
    resetC64MachineMock.mockResolvedValue(undefined);

    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-runner-skip-policy-"));
    const { runCase } = await import("../src/validation/runner.js");

    try {
      const result = await runCase(
        {
          id: "TEST-SKIP-POLICY",
          name: "Runner Skip Policy Case",
          caseId: "RUN-005",
          featureArea: "Settings",
          route: "/settings",
          validationTrack: "product",
          safetyClass: "read-only",
          expectedOutcome: "pass",
          oracleClasses: ["UI", "REST-visible state"],
          run: async (ctx) => {
            const stepResult = await ctx.store.recordStep({
              runId: ctx.runId,
              stepId: "step-01",
              route: "/settings",
              featureArea: "Settings",
              action: "inspect_connection",
              peerServer: "c64bridge",
              primaryOracle: "REST-visible state",
              bridgeFallbackCategory: "app_path_unavailable",
              bridgeFallbackJustification: "The app route was unavailable for this inspection",
            });
            expect(stepResult.ok).toBe(true);

            const sessionPath = path.join(ctx.artifactDir, "session.json");
            const session = JSON.parse(await readFile(sessionPath, "utf-8")) as {
              timeline: Array<Record<string, string | null>>;
            };
            session.timeline.push({
              stepId: "step-02",
              route: "/settings",
              featureArea: "Settings",
              action: "inspect_from_ui",
              peerServer: "mobile_controller",
              primaryOracle: "UI",
              fallbackOracle: null,
              bridgeFallbackCategory: null,
              bridgeFallbackJustification: null,
              recordedAt: new Date().toISOString(),
              notes: null,
            });
            session.timeline.push({
              stepId: "step-03",
              route: "/settings",
              featureArea: "Settings",
              action: "",
              peerServer: "",
              primaryOracle: "UI",
              fallbackOracle: null,
              bridgeFallbackCategory: null,
              bridgeFallbackJustification: null,
              recordedAt: new Date().toISOString(),
              notes: null,
            });
            await writeFile(sessionPath, JSON.stringify(session, null, 2), "utf-8");

            return {
              assertions: [
                { oracleClass: "UI", passed: true, details: {} },
                { oracleClass: "REST-visible state", passed: true, details: {} },
              ],
              explorationTrace: {
                routeDiscovery: ["/settings"],
                decisionLog: [],
                safetyBudget: "read-only",
                oracleSelection: ["UI", "REST-visible state"],
                recoveryActions: [],
              },
            };
          },
        },
        "serial-1",
        "c64u",
        artifactRoot,
      );

      expect(result.outcome).toBe("pass");
      expect(result.explorationTrace.recoveryActions).toEqual([]);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("writes unknown hardware identity fields and leaves peer usage empty when no evidence or timeline peers exist", async () => {
    adbMock
      .mockResolvedValueOnce("Pixel")
      .mockResolvedValueOnce("tensor")
      .mockResolvedValueOnce("phone")
      .mockResolvedValueOnce("14");
    c64uGetMock.mockResolvedValueOnce(JSON.stringify({}));
    resetC64MachineMock.mockResolvedValue(undefined);

    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-runner-unknowns-"));
    const { runCase } = await import("../src/validation/runner.js");

    try {
      const result = await runCase(
        {
          id: "TEST-UNKNOWNS",
          name: "Runner Unknowns Case",
          caseId: "RUN-006",
          featureArea: "Docs",
          route: "/docs",
          validationTrack: "calibration",
          safetyClass: "read-only",
          expectedOutcome: "pass",
          oracleClasses: ["UI", "REST-visible state"],
          run: async () => ({
            assertions: [
              { oracleClass: "UI", passed: true, details: {} },
              { oracleClass: "REST-visible state", passed: true, details: {} },
            ],
            explorationTrace: {
              routeDiscovery: ["/docs"],
              decisionLog: [],
              safetyBudget: "read-only",
              oracleSelection: ["UI", "REST-visible state"],
              recoveryActions: [],
            },
          }),
        },
        "serial-1",
        "c64u",
        artifactRoot,
      );

      const hardwareProof = JSON.parse(await readFile(path.join(result.artifactDir, "hardware-proof.json"), "utf-8"));
      const llmTrace = JSON.parse(await readFile(path.join(result.artifactDir, "llm-decision-trace.json"), "utf-8"));

      expect(hardwareProof.c64u).toMatchObject({
        hostname: "unknown",
        firmware: "unknown",
        product: "unknown",
        uniqueId: "unknown",
      });
      expect(llmTrace.peerServersUsed).toEqual([]);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("fails fast when the session store cannot start a run", async () => {
    vi.resetModules();
    vi.doMock("../src/sessionStore.js", () => ({
      ScopeSessionStore: vi.fn().mockImplementation(() => ({
        startSession: vi.fn().mockResolvedValue({
          ok: false,
          error: { message: "session-start failed" },
        }),
      })),
    }));

    const { runCase } = await import("../src/validation/runner.js");

    await expect(
      runCase(
        {
          id: "TEST-START-FAIL",
          name: "Runner Start Failure",
          caseId: "RUN-007",
          featureArea: "Play",
          route: "/play",
          validationTrack: "calibration",
          safetyClass: "read-only",
          expectedOutcome: "inconclusive",
          oracleClasses: ["UI"],
          run: async () => ({
            assertions: [{ oracleClass: "UI", passed: true, details: {} }],
            explorationTrace: {
              routeDiscovery: ["/play"],
              decisionLog: [],
              safetyBudget: "read-only",
              oracleSelection: ["UI"],
              recoveryActions: [],
            },
          }),
        },
        "serial-1",
        "c64u",
        "/tmp/c64scope-runner-start-fail",
      ),
    ).rejects.toThrow(/Failed to start session: session-start failed/);
  });
});

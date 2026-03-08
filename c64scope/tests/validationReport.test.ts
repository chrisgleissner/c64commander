/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { generateReport } from "../src/validation/report.js";

describe("validation report", () => {
  it("renders inventory, repeatability, peer proof, and termination criteria", () => {
    const report = generateReport(
      [
        {
          caseId: "CASE-1",
          caseName: "Case One",
          featureArea: "Play",
          route: "/play",
          validationTrack: "product",
          runId: "run-1",
          outcome: "pass",
          failureClass: "inconclusive",
          oracleClasses: ["UI", "A/V signal"],
          artifactDir: "/tmp/run-1",
          artifacts: ["session.json", "llm-decision-trace.json", "hardware-proof.json"],
          explorationTrace: {
            routeDiscovery: [],
            decisionLog: ["peer:mobile_controller"],
            safetyBudget: "read-only",
            oracleSelection: [],
            recoveryActions: [],
          },
          durationMs: 1234,
        },
        {
          caseId: "CASE-1",
          caseName: "Case One",
          featureArea: "Play",
          route: "/play",
          validationTrack: "product",
          runId: "run-2",
          outcome: "fail",
          failureClass: "product_failure",
          oracleClasses: ["UI", "REST-visible state"],
          artifactDir: "/tmp/run-2",
          artifacts: ["session.json", "llm-decision-trace.json", "hardware-proof.json"],
          explorationTrace: {
            routeDiscovery: [],
            decisionLog: ["peer:c64scope"],
            safetyBudget: "guarded-mutation",
            oracleSelection: [],
            recoveryActions: [],
          },
          durationMs: 2222,
        },
        {
          caseId: "CASE-1",
          caseName: "Case One",
          featureArea: "Play",
          route: "/play",
          validationTrack: "product",
          runId: "run-3",
          outcome: "pass",
          failureClass: "inconclusive",
          oracleClasses: ["UI", "REST-visible state"],
          artifactDir: "/tmp/run-3",
          artifacts: ["session.json", "llm-decision-trace.json", "hardware-proof.json"],
          explorationTrace: {
            routeDiscovery: [],
            decisionLog: [],
            safetyBudget: "guarded-mutation",
            oracleSelection: [],
            recoveryActions: [],
          },
          durationMs: 3333,
        },
      ],
      "serial-1",
      "c64u",
      {
        product: "Ultimate 64",
        firmware_version: "1.0",
        fpga_version: "2.0",
        core_version: "3.0",
        unique_id: "abc",
      },
      {
        model: "Phone",
        hardware: "hw",
        osVersion: "14",
        characteristics: "default",
      },
      3,
    );

    expect(report).toContain("Autonomous Agentic Validation Report");
    expect(report).toContain("Repeatability Metrics");
    expect(report).toContain("Peer MCP Server Usage Proof");
    expect(report).toContain("Termination Criteria Verification");
    expect(report).toContain("| CASE-1 | 3 |");
  });

  it("renders empty peer and failure sections when no runs fail and repeatability is disabled", () => {
    const report = generateReport(
      [
        {
          caseId: "FAIL-CLASSIFY-001",
          caseName: "Failure Case",
          featureArea: "Home",
          route: "/",
          validationTrack: "product",
          runId: "run-1",
          outcome: "fail",
          failureClass: "product_failure",
          oracleClasses: ["UI", "REST-visible state"],
          artifactDir: "/tmp/run-1",
          artifacts: ["session.json", "summary.md", "llm-decision-trace.json", "hardware-proof.json"],
          explorationTrace: {
            routeDiscovery: [],
            decisionLog: [],
            safetyBudget: "read-only",
            oracleSelection: [],
            recoveryActions: [],
          },
          durationMs: 100,
        },
      ],
      "serial-1",
      "c64u",
      {
        product: "Ultimate 64",
        firmware_version: "1.0",
        fpga_version: "2.0",
        core_version: "3.0",
        unique_id: "abc",
      },
      {
        model: "Phone",
        hardware: "hw",
        osVersion: "14",
        characteristics: "default",
      },
      1,
    );

    expect(report).not.toContain("Repeatability Metrics");
    expect(report).toContain("| run-1 | FAIL-CLASSIFY-001 | product_failure | Home |");
    expect(report).toContain("No peer-server claims were synthesized");
    expect(report).toContain("Some termination criteria not yet satisfied.");
  });
});

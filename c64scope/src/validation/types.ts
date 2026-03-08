/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AssertionRecord } from "../oraclePolicy.js";
import type { ScopeSessionStore } from "../sessionStore.js";

export interface ValidationCase {
  id: string;
  name: string;
  caseId: string;
  featureArea: string;
  route: string;
  safetyClass: "read-only" | "guarded-mutation";
  validationTrack: "product" | "calibration";
  expectedOutcome: "pass" | "fail";
  oracleClasses: string[];
  run: (ctx: CaseContext) => Promise<CaseResult>;
}

export interface CaseContext {
  store: ScopeSessionStore;
  runId: string;
  serial: string;
  c64uHost: string;
  artifactDir: string;
}

export interface CaseResult {
  assertions: AssertionRecord[];
  explorationTrace: ExplorationTrace;
}

export interface ExplorationTrace {
  routeDiscovery: string[];
  decisionLog: string[];
  safetyBudget: string;
  oracleSelection: string[];
  recoveryActions: string[];
}

export interface RunResult {
  caseId: string;
  caseName: string;
  featureArea: string;
  route: string;
  validationTrack: "product" | "calibration";
  runId: string;
  outcome: string;
  failureClass: string;
  oracleClasses: string[];
  artifactDir: string;
  artifacts: string[];
  explorationTrace: ExplorationTrace;
  durationMs: number;
}

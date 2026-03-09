/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ExplorationSafety } from "./exploration.js";
import type { FailureClass, RunOutcome } from "./types.js";

// ---------------------------------------------------------------------------
// Oracle classes (ORC-001)
// ---------------------------------------------------------------------------

export type OracleClass =
  | "UI"
  | "REST-visible state"
  | "FTP-visible state"
  | "Filesystem-visible state"
  | "Diagnostics and logs"
  | "State refs"
  | "A/V signal";

export const oracleClasses: readonly OracleClass[] = [
  "UI",
  "REST-visible state",
  "FTP-visible state",
  "Filesystem-visible state",
  "Diagnostics and logs",
  "State refs",
  "A/V signal",
];

// ---------------------------------------------------------------------------
// Weak-oracle patterns (ORC-001) — from agentic-oracle-catalog.md
// ---------------------------------------------------------------------------

export interface WeakOraclePattern {
  id: string;
  description: string;
  detect: (assertions: AssertionRecord[]) => boolean;
}

export interface AssertionRecord {
  oracleClass: string;
  passed: boolean;
  details: Record<string, unknown>;
}

export const weakOraclePatterns: readonly WeakOraclePattern[] = [
  {
    id: "single-toast-success",
    description: "A toast is the only positive signal.",
    detect: (assertions) =>
      assertions.length === 1 &&
      assertions[0]!.passed &&
      assertions[0]!.oracleClass === "UI" &&
      assertions[0]!.details["source"] === "toast",
  },
  {
    id: "single-screenshot-no-corroboration",
    description: "A single screenshot without state correlation.",
    detect: (assertions) =>
      assertions.length === 1 &&
      assertions[0]!.passed &&
      assertions[0]!.oracleClass === "UI" &&
      assertions[0]!.details["source"] === "screenshot",
  },
  {
    id: "av-only-for-non-playback",
    description: "A/V-only proof for settings, config, disk-library, or diagnostics workflows.",
    detect: (assertions) => {
      const passed = assertions.filter((a) => a.passed);
      return (
        passed.length > 0 &&
        passed.every((a) => a.oracleClass === "A/V signal") &&
        passed.some(
          (a) =>
            a.details["featureArea"] === "Settings" ||
            a.details["featureArea"] === "Config" ||
            a.details["featureArea"] === "Disks" ||
            a.details["featureArea"] === "Diagnostics",
        )
      );
    },
  },
  {
    id: "log-without-context",
    description: "Log lines without matching route/action/timestamp context.",
    detect: (assertions) =>
      assertions.length === 1 &&
      assertions[0]!.passed &&
      assertions[0]!.oracleClass === "Diagnostics and logs" &&
      !assertions[0]!.details["correlated"],
  },
  {
    id: "crash-absence-as-success",
    description: "Absence of a crash as proof of success.",
    detect: (assertions) =>
      assertions.length === 1 && assertions[0]!.passed && assertions[0]!.details["source"] === "no-crash",
  },
];

/**
 * Detect weak oracle patterns in an assertion set. Returns matched weak
 * patterns. If any are matched, the result should not be classified as pass
 * without additional corroboration.
 */
export function detectWeakPatterns(assertions: AssertionRecord[]): WeakOraclePattern[] {
  return weakOraclePatterns.filter((p) => p.detect(assertions));
}

// ---------------------------------------------------------------------------
// Pairwise oracle enforcement (ORC-003)
// ---------------------------------------------------------------------------

/**
 * For guarded-mutation and destructive actions, at least two independent
 * oracle classes must provide positive evidence. Returns whether the
 * corroboration requirement is satisfied.
 */
export function checkCorroboration(
  safety: ExplorationSafety,
  assertions: AssertionRecord[],
): { satisfied: boolean; reason: string } {
  if (safety === "read-only") {
    return { satisfied: true, reason: "Read-only actions do not require corroboration." };
  }

  const passedClasses = new Set(assertions.filter((a) => a.passed).map((a) => a.oracleClass));

  if (passedClasses.size < 2) {
    return {
      satisfied: false,
      reason: `${safety} actions require at least 2 independent oracle classes; found ${passedClasses.size}.`,
    };
  }

  return { satisfied: true, reason: "Corroboration satisfied." };
}

// ---------------------------------------------------------------------------
// Deterministic classification (ORC-004)
// ---------------------------------------------------------------------------

export interface ClassificationInput {
  assertions: AssertionRecord[];
  safety: ExplorationSafety;
}

export interface ClassificationResult {
  outcome: RunOutcome;
  failureClass: FailureClass;
  weakPatterns: string[];
  corroborationSatisfied: boolean;
  reason: string;
}

const INFRA_ORACLE_CLASSES: ReadonlySet<string> = new Set([
  "A/V signal",
  "Filesystem-visible state",
  "Diagnostics and logs",
]);

/**
 * Classify a run into pass/fail/inconclusive with full justification.
 * Enforces weak-oracle rejection and pairwise corroboration.
 */
export function classifyRun(input: ClassificationInput): ClassificationResult {
  const { assertions, safety } = input;

  if (assertions.length === 0) {
    return {
      outcome: "inconclusive",
      failureClass: "inconclusive",
      weakPatterns: [],
      corroborationSatisfied: false,
      reason: "No assertions recorded.",
    };
  }

  const weakMatches = detectWeakPatterns(assertions);
  const corroboration = checkCorroboration(safety, assertions);

  const allPassed = assertions.every((a) => a.passed);
  const anyFailed = assertions.some((a) => !a.passed);

  // Weak pattern rejection — even if assertions passed, weak evidence is inconclusive
  if (allPassed && weakMatches.length > 0) {
    return {
      outcome: "inconclusive",
      failureClass: "inconclusive",
      weakPatterns: weakMatches.map((p) => p.id),
      corroborationSatisfied: corroboration.satisfied,
      reason: `Weak oracle pattern detected: ${weakMatches.map((p) => p.id).join(", ")}`,
    };
  }

  // Corroboration enforcement for non-read-only
  if (allPassed && !corroboration.satisfied) {
    return {
      outcome: "inconclusive",
      failureClass: "inconclusive",
      weakPatterns: [],
      corroborationSatisfied: false,
      reason: corroboration.reason,
    };
  }

  if (allPassed) {
    return {
      outcome: "pass",
      failureClass: "product_failure",
      weakPatterns: [],
      corroborationSatisfied: true,
      reason: "All assertions passed with sufficient evidence.",
    };
  }

  if (anyFailed) {
    const failedAssertions = assertions.filter((a) => !a.passed);
    const allInfra = failedAssertions.every((a) => INFRA_ORACLE_CLASSES.has(a.oracleClass));

    if (allInfra) {
      return {
        outcome: "fail",
        failureClass: "infrastructure_failure",
        weakPatterns: weakMatches.map((p) => p.id),
        corroborationSatisfied: corroboration.satisfied,
        reason: "All failures are from infrastructure oracle classes (A/V, filesystem, diagnostics).",
      };
    }

    return {
      outcome: "fail",
      failureClass: "product_failure",
      weakPatterns: weakMatches.map((p) => p.id),
      corroborationSatisfied: corroboration.satisfied,
      reason: "Product assertion failures detected.",
    };
  }

  return {
    outcome: "inconclusive",
    failureClass: "inconclusive",
    weakPatterns: [],
    corroborationSatisfied: corroboration.satisfied,
    reason: "Mixed assertion state could not be classified.",
  };
}

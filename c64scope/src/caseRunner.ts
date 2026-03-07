import { caseCatalog, type CaseDefinition, testNamespaces } from "./catalog.js";

export type CaseStatus = "ready" | "blocked-dependency" | "blocked-testability" | "inconclusive";

export interface CaseEvaluation {
  caseId: string;
  status: CaseStatus;
  reason: string;
  case: CaseDefinition | undefined;
}

export interface ReadyCaseSet {
  ready: CaseDefinition[];
  blocked: CaseEvaluation[];
}

/**
 * Look up a case by ID. Returns undefined if not found.
 */
export function resolveCase(caseId: string): CaseDefinition | undefined {
  return caseCatalog.find((c) => c.id === caseId);
}

/**
 * Evaluate whether a case can be executed given a set of already-completed case IDs.
 */
export function evaluateCase(caseId: string, completedCaseIds: ReadonlySet<string>): CaseEvaluation {
  const caseDef = resolveCase(caseId);
  if (!caseDef) {
    return {
      caseId,
      status: "inconclusive",
      reason: `Unknown case ID: ${caseId}`,
      case: undefined,
    };
  }

  if (caseDef.testability === "partial" || caseDef.testability === "blocked") {
    return {
      caseId,
      status: "blocked-testability",
      reason: `Case testability is '${caseDef.testability}'${caseDef.blockerRef ? ` (blocker: ${caseDef.blockerRef})` : ""}`,
      case: caseDef,
    };
  }

  const unmetDeps = caseDef.dependencies.filter((dep) => !completedCaseIds.has(dep));
  if (unmetDeps.length > 0) {
    return {
      caseId,
      status: "blocked-dependency",
      reason: `Unmet dependencies: ${unmetDeps.join(", ")}`,
      case: caseDef,
    };
  }

  return {
    caseId,
    status: "ready",
    reason: "All dependencies satisfied and testability is ready or guarded",
    case: caseDef,
  };
}

/**
 * Build a prioritized list of executable cases, respecting dependency order.
 * Returns ready cases sorted by dependency depth (shallowest first) and blocked cases.
 */
export function buildReadyCaseSet(completedCaseIds: ReadonlySet<string> = new Set()): ReadyCaseSet {
  const ready: CaseDefinition[] = [];
  const blocked: CaseEvaluation[] = [];

  for (const caseDef of caseCatalog) {
    if (completedCaseIds.has(caseDef.id)) {
      continue;
    }
    const evaluation = evaluateCase(caseDef.id, completedCaseIds);
    if (evaluation.status === "ready") {
      ready.push(caseDef);
    } else {
      blocked.push(evaluation);
    }
  }

  ready.sort((a, b) => a.dependencies.length - b.dependencies.length);

  return { ready, blocked };
}

/**
 * Select the next highest-priority case that can execute now.
 * Priority: fewest dependencies first (shallowest), then catalog order.
 */
export function selectNextCase(completedCaseIds: ReadonlySet<string> = new Set()): CaseEvaluation {
  const { ready } = buildReadyCaseSet(completedCaseIds);

  if (ready.length === 0) {
    return {
      caseId: "",
      status: "inconclusive",
      reason: "No executable cases remain",
      case: undefined,
    };
  }

  const next = ready[0]!;
  return {
    caseId: next.id,
    status: "ready",
    reason: "Highest-priority executable case",
    case: next,
  };
}

/**
 * Classify a run result based on assertions and evidence.
 */
export function classifyRunResult(
  assertions: {
    passed: boolean;
    oracleClass: string;
  }[],
): {
  outcome: "pass" | "fail" | "inconclusive";
  failureClass: "product_failure" | "infrastructure_failure" | "inconclusive";
} {
  if (assertions.length === 0) {
    return { outcome: "inconclusive", failureClass: "inconclusive" };
  }

  const allPassed = assertions.every((a) => a.passed);
  const anyFailed = assertions.some((a) => !a.passed);

  if (allPassed) {
    return { outcome: "pass", failureClass: "inconclusive" };
  }

  if (anyFailed) {
    const infraOracleClasses = ["A/V signal", "Filesystem-visible state", "Diagnostics and logs"];
    const failedAssertions = assertions.filter((a) => !a.passed);
    const allInfra = failedAssertions.every((a) => infraOracleClasses.includes(a.oracleClass));

    if (allInfra) {
      return { outcome: "fail", failureClass: "infrastructure_failure" };
    }

    return { outcome: "fail", failureClass: "product_failure" };
  }

  return { outcome: "inconclusive", failureClass: "inconclusive" };
}

/**
 * Validate that a cleanup path targets only test-owned namespaces.
 */
export function isTestOwnedPath(targetPath: string): boolean {
  const allowedPrefixes = Object.values(testNamespaces);
  return allowedPrefixes.some((prefix) => targetPath.startsWith(prefix));
}

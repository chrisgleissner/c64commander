/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { shouldRefuseAction } from "../exploration.js";
import type { ExplorationSafety } from "../exploration.js";

// ---------------------------------------------------------------------------
// CTA risk refinement (R0-R4) -> canonical action class
//
// R0-R4 are a refinement overlay over the canonical action classes defined in
// agentic-safety-policy.md (Read-only / Guarded mutation / Destructive mutation
// / Prohibited). They pre-classify an individual CTA so the bulk runner can
// decide whether it may auto-exercise it without an LLM in the loop. See the
// full-cta-coverage prompt Section 5.1 for the mapping table.
// ---------------------------------------------------------------------------

export type CtaRiskRefinement = "R0" | "R1" | "R2" | "R3" | "R4";

export type CanonicalActionClass = ExplorationSafety | "prohibited";

export interface RefinementRule {
  refinement: CtaRiskRefinement;
  actionClass: CanonicalActionClass;
  automationRule: string;
}

export const refinementRules: readonly RefinementRule[] = [
  {
    refinement: "R0",
    actionClass: "read-only",
    automationRule: "Auto-exercise.",
  },
  {
    refinement: "R1",
    actionClass: "guarded-mutation",
    automationRule: "Auto if original captured and restored.",
  },
  {
    refinement: "R2",
    actionClass: "guarded-mutation",
    automationRule:
      "Auto only with before-state, app-driven restore path, expected postcondition, and a registered scenario/oracle. Respect the per-family budget table.",
  },
  {
    refinement: "R3",
    actionClass: "destructive",
    automationRule:
      "Never auto. Requires a dedicated scenario manifest: approval, backup, recovery, evidence plan, cleanup, post-recovery verification.",
  },
  {
    refinement: "R4",
    actionClass: "prohibited",
    automationRule: "Never auto. Record UNCLASSIFIED/BLOCKED/SPEC_GAP, or a defect if it should be safely testable.",
  },
];

export function actionClassForRefinement(refinement: CtaRiskRefinement): CanonicalActionClass {
  const rule = refinementRules.find((entry) => entry.refinement === refinement);
  if (!rule) {
    throw new Error(`Unknown CTA risk refinement: ${refinement}`);
  }
  return rule.actionClass;
}

/**
 * A CTA with action class "prohibited" (R4) or "destructive" (R3) must never be
 * auto-exercised by the bulk runner. R0 is always auto-eligible; R1/R2 require
 * the listed preconditions (captured elsewhere) but are not refused on class.
 */
export function isAutoEligible(refinement: CtaRiskRefinement): boolean {
  const actionClass = actionClassForRefinement(refinement);
  return actionClass !== "prohibited" && actionClass !== "destructive";
}

// ---------------------------------------------------------------------------
// Per-family mutation budgets
//
// These refine the per-family budgets from agentic-safety-policy.md. A normal
// (non-dedicated) case may spend up to maxPerCase invocations of a family;
// families with maxPerCase === DEDICATED_CASE_ONLY are never allowed inside a
// normal case and require their own scenario case. AOQ references are from
// agentic-open-questions.md.
// ---------------------------------------------------------------------------

export const DEDICATED_CASE_ONLY = -1;

export type MutationFamily =
  | "machine-reset"
  | "machine-reboot"
  | "machine-reboot-clear-memory"
  | "power-cycle"
  | "power-off"
  | "ram-save-load"
  | "flash-config"
  | "config-mutation"
  | "disk-mount-eject"
  | "disk-library-mutate"
  | "disk-delete"
  | "playlist-mutate"
  | "hvsc-download"
  | "settings-mutate"
  | "device-switch"
  | "stream-control";

export interface FamilyBudget {
  family: MutationFamily;
  actionClass: ExplorationSafety;
  maxPerCase: number;
  requiredGuard: string;
  cleanupRequirement: string;
}

const defaultBudgetEntries: readonly FamilyBudget[] = [
  {
    family: "machine-reset",
    actionClass: "destructive",
    maxPerCase: 1,
    requiredGuard: "Capture pre-state; verify reset attribution to the current case.",
    cleanupRequirement: "Return the machine to a known route/state.",
  },
  {
    family: "machine-reboot",
    actionClass: "destructive",
    maxPerCase: 1,
    requiredGuard: "Capture pre-state; distinguish normal vs clear-memory reboot (AOQ-002).",
    cleanupRequirement: "Reconnect and refresh app state after the reboot.",
  },
  {
    family: "machine-reboot-clear-memory",
    actionClass: "destructive",
    maxPerCase: 1,
    requiredGuard: "Use known RAM markers to prove clear-memory semantics (AOQ-002).",
    cleanupRequirement: "Restore RAM markers or accept the cleared baseline.",
  },
  {
    family: "power-cycle",
    actionClass: "destructive",
    maxPerCase: 1,
    requiredGuard: "Capture full device baseline before cycling power.",
    cleanupRequirement: "Verify device returns online and app reconnects.",
  },
  {
    family: "power-off",
    actionClass: "destructive",
    maxPerCase: DEDICATED_CASE_ONLY,
    requiredGuard: "Dedicated case only with an independently verified power-restore path.",
    cleanupRequirement: "Power must be restored and verified before any other case continues.",
  },
  {
    family: "ram-save-load",
    actionClass: "guarded-mutation",
    maxPerCase: 8,
    requiredGuard: "Capture original RAM/REU marker before load; restore after.",
    cleanupRequirement: "Restore original RAM state via app path.",
  },
  {
    family: "flash-config",
    actionClass: "destructive",
    maxPerCase: 2,
    requiredGuard: "Back up flash config before write; test-owned namespace only.",
    cleanupRequirement: "Restore flash config from backup via app path.",
  },
  {
    family: "config-mutation",
    actionClass: "guarded-mutation",
    maxPerCase: 40,
    requiredGuard: "Capture original value; force app-driven fresh readback before restore (AOQ-004).",
    cleanupRequirement: "Restore original value via app and verify with a fresh read.",
  },
  {
    family: "disk-mount-eject",
    actionClass: "guarded-mutation",
    maxPerCase: 30,
    requiredGuard: "Record mounted-drive baseline before mutation.",
    cleanupRequirement: "Return drives to baseline mount state.",
  },
  {
    family: "disk-library-mutate",
    actionClass: "guarded-mutation",
    maxPerCase: 30,
    requiredGuard: "Operate only inside a test-owned disk namespace.",
    cleanupRequirement: "Remove test-owned entries; leave user data untouched.",
  },
  {
    family: "disk-delete",
    actionClass: "destructive",
    maxPerCase: 10,
    requiredGuard: "Delete only test-owned disks; capture library diff before and after.",
    cleanupRequirement: "Confirm no user-owned disk was removed.",
  },
  {
    family: "playlist-mutate",
    actionClass: "guarded-mutation",
    maxPerCase: 100,
    requiredGuard: "Capture playlist baseline; playlist is per-device durable state.",
    cleanupRequirement: "Remove test playlist entries.",
  },
  {
    family: "hvsc-download",
    actionClass: "guarded-mutation",
    maxPerCase: 2,
    requiredGuard: "One full download cycle plus one retry (AOQ-007).",
    cleanupRequirement: "Leave HVSC in a known installed/reset state.",
  },
  {
    family: "settings-mutate",
    actionClass: "guarded-mutation",
    maxPerCase: 40,
    requiredGuard: "Capture original setting; persist across relaunch where expected.",
    cleanupRequirement: "Restore original setting and verify after relaunch.",
  },
  {
    family: "device-switch",
    actionClass: "guarded-mutation",
    maxPerCase: 20,
    requiredGuard: "Verify actual target identity via app-driven fresh device info after every switch.",
    cleanupRequirement: "Restore saved-device selection to c64u.",
  },
  {
    family: "stream-control",
    actionClass: "guarded-mutation",
    maxPerCase: 12,
    requiredGuard: "Stream is calibration plumbing; reserve/release explicitly (AOQ-003).",
    cleanupRequirement: "Stop test streams after the case.",
  },
];

export const defaultFamilyBudgets: ReadonlyMap<MutationFamily, FamilyBudget> = new Map(
  defaultBudgetEntries.map((entry) => [entry.family, entry] as const),
);

// ---------------------------------------------------------------------------
// Per-case budget tracker
// ---------------------------------------------------------------------------

export interface BudgetDecision {
  refuse: boolean;
  reason: string;
  remaining: number;
}

export class MutationBudgetTracker {
  private readonly counts = new Map<MutationFamily, number>();
  private readonly budgets: ReadonlyMap<MutationFamily, FamilyBudget>;

  constructor(budgets: ReadonlyMap<MutationFamily, FamilyBudget> = defaultFamilyBudgets) {
    this.budgets = budgets;
  }

  request(family: MutationFamily, context: "normal-case" | "dedicated-case" = "normal-case"): BudgetDecision {
    const budget = this.budgets.get(family);
    if (!budget) {
      return {
        refuse: true,
        reason: `Unknown mutation family "${family}"; refusing unclassified mutation.`,
        remaining: 0,
      };
    }

    if (budget.maxPerCase === DEDICATED_CASE_ONLY && context !== "dedicated-case") {
      return {
        refuse: true,
        reason: `Mutation family "${family}" is dedicated-case-only (requires its own scenario with a verified restore path).`,
        remaining: 0,
      };
    }

    const used = this.counts.get(family) ?? 0;
    const max = budget.maxPerCase === DEDICATED_CASE_ONLY ? 1 : budget.maxPerCase;
    if (used >= max) {
      return {
        refuse: true,
        reason: `Mutation budget for "${family}" exhausted (${used}/${max} per case).`,
        remaining: 0,
      };
    }

    this.counts.set(family, used + 1);
    return { refuse: false, reason: budget.requiredGuard, remaining: max - (used + 1) };
  }

  resetForCase(): void {
    this.counts.clear();
  }

  usage(): Map<MutationFamily, number> {
    return new Map(this.counts);
  }
}

// ---------------------------------------------------------------------------
// Combined CTA action gate
//
// A CTA action is allowed only when (a) its refinement class does not exceed
// the exploration budget via the canonical gate, (b) the refinement is
// auto-eligible, and (c) the per-family budget (if the CTA names a family) has
// capacity. R3/R4 and any class above budget are refused before activation.
// ---------------------------------------------------------------------------

export interface CtaActionRequest {
  refinement: CtaRiskRefinement;
  family?: MutationFamily;
  budget: ExplorationSafety;
  caseContext?: "normal-case" | "dedicated-case";
}

export interface CtaActionDecision {
  refuse: boolean;
  reasons: string[];
  actionClass: CanonicalActionClass;
  remaining?: number;
}

export function evaluateCtaAction(request: CtaActionRequest, tracker: MutationBudgetTracker): CtaActionDecision {
  const reasons: string[] = [];
  const actionClass = actionClassForRefinement(request.refinement);

  const effectiveSafety: ExplorationSafety = actionClass === "prohibited" ? "destructive" : actionClass;
  const coarse = shouldRefuseAction(effectiveSafety, request.budget);
  if (coarse.refuse) {
    reasons.push(coarse.reason);
  }

  if (!isAutoEligible(request.refinement)) {
    reasons.push(
      `Refinement ${request.refinement} (${actionClass}) is not auto-eligible; requires a dedicated scenario.`,
    );
  }

  // A class-level refusal must not consume a family budget.
  if (reasons.length > 0) {
    return { refuse: true, reasons, actionClass };
  }

  let remaining: number | undefined;
  if (request.family) {
    const budgetDecision = tracker.request(request.family, request.caseContext ?? "normal-case");
    if (budgetDecision.refuse) {
      reasons.push(budgetDecision.reason);
    } else {
      remaining = budgetDecision.remaining;
    }
  }

  return { refuse: reasons.length > 0, reasons, actionClass, remaining };
}

// ---------------------------------------------------------------------------
// Per-CTA result statuses (Section 5.4)
//
// Only PASS counts as passed coverage. Extends the full-app-coverage
// PASS/FAIL/BLOCKED vocabulary with the finer states this program needs.
// ---------------------------------------------------------------------------

export type CtaResultStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "INCONCLUSIVE"
  | "NOT_PRESENT"
  | "SPEC_GAP"
  | "UNCLASSIFIED"
  | "CALIBRATION_ONLY";

export function isPass(status: CtaResultStatus): boolean {
  return status === "PASS";
}

export function isBlocking(status: CtaResultStatus): boolean {
  return status === "FAIL" || status === "BLOCKED";
}

/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  actionClassForRefinement,
  defaultFamilyBudgets,
  DEDICATED_CASE_ONLY,
  evaluateCtaAction,
  isAutoEligible,
  isBlocking,
  isPass,
  MutationBudgetTracker,
  refinementRules,
} from "../src/cta/riskModel.js";

describe("refinement -> action class mapping (Section 5.1)", () => {
  it("maps every refinement to its canonical action class", () => {
    expect(actionClassForRefinement("R0")).toBe("read-only");
    expect(actionClassForRefinement("R1")).toBe("guarded-mutation");
    expect(actionClassForRefinement("R2")).toBe("guarded-mutation");
    expect(actionClassForRefinement("R3")).toBe("destructive");
    expect(actionClassForRefinement("R4")).toBe("prohibited");
  });

  it("throws on an unknown refinement", () => {
    expect(() => actionClassForRefinement("R9" as never)).toThrow();
  });

  it("defines exactly the five refinement rules", () => {
    expect(refinementRules.map((r) => r.refinement)).toEqual(["R0", "R1", "R2", "R3", "R4"]);
  });

  it("only R0/R1/R2 are auto-eligible; R3/R4 require a dedicated scenario", () => {
    expect(isAutoEligible("R0")).toBe(true);
    expect(isAutoEligible("R1")).toBe(true);
    expect(isAutoEligible("R2")).toBe(true);
    expect(isAutoEligible("R3")).toBe(false);
    expect(isAutoEligible("R4")).toBe(false);
  });
});

describe("per-family mutation budgets", () => {
  it("marks power-off as dedicated-case-only", () => {
    expect(defaultFamilyBudgets.get("power-off")?.maxPerCase).toBe(DEDICATED_CASE_ONLY);
  });

  it("caps machine-reset and machine-reboot at one per case (AOQ-002)", () => {
    expect(defaultFamilyBudgets.get("machine-reset")?.maxPerCase).toBe(1);
    expect(defaultFamilyBudgets.get("machine-reboot")?.maxPerCase).toBe(1);
  });

  it("caps hvsc-download at one cycle plus one retry (AOQ-007)", () => {
    expect(defaultFamilyBudgets.get("hvsc-download")?.maxPerCase).toBe(2);
  });
});

describe("MutationBudgetTracker", () => {
  it("allows a single machine-reset per case then refuses", () => {
    const tracker = new MutationBudgetTracker();
    const first = tracker.request("machine-reset");
    expect(first.refuse).toBe(false);
    expect(first.remaining).toBe(0);

    const second = tracker.request("machine-reset");
    expect(second.refuse).toBe(true);
    expect(second.reason).toContain("exhausted");
  });

  it("refuses power-off in a normal case but allows it in a dedicated case", () => {
    const tracker = new MutationBudgetTracker();
    expect(tracker.request("power-off").refuse).toBe(true);
    expect(tracker.request("power-off", "dedicated-case").refuse).toBe(false);
  });

  it("refuses an unknown family (budget not present in the table)", () => {
    const tracker = new MutationBudgetTracker(new Map());
    const decision = tracker.request("machine-reset");
    expect(decision.refuse).toBe(true);
    expect(decision.reason).toContain("Unknown mutation family");
  });

  it("resetForCase clears accumulated usage", () => {
    const tracker = new MutationBudgetTracker();
    tracker.request("config-mutation");
    tracker.request("config-mutation");
    expect(tracker.usage().get("config-mutation")).toBe(2);
    tracker.resetForCase();
    expect(tracker.usage().get("config-mutation")).toBeUndefined();
  });
});

describe("evaluateCtaAction", () => {
  it("allows an R0 read-only control within a read-only budget without consuming a family budget", () => {
    const tracker = new MutationBudgetTracker();
    const decision = evaluateCtaAction({ refinement: "R0", budget: "read-only" }, tracker);
    expect(decision.refuse).toBe(false);
    expect(decision.actionClass).toBe("read-only");
    expect(tracker.usage().size).toBe(0);
  });

  it("refuses an R3 destructive control even under a destructive budget", () => {
    const tracker = new MutationBudgetTracker();
    const decision = evaluateCtaAction({ refinement: "R3", budget: "destructive" }, tracker);
    expect(decision.refuse).toBe(true);
    expect(decision.reasons.some((r) => r.includes("not auto-eligible"))).toBe(true);
  });

  it("refuses an R4 prohibited control", () => {
    const tracker = new MutationBudgetTracker();
    const decision = evaluateCtaAction({ refinement: "R4", budget: "destructive" }, tracker);
    expect(decision.refuse).toBe(true);
  });

  it("refuses an R2 device mutation under a read-only budget without consuming budget", () => {
    const tracker = new MutationBudgetTracker();
    const decision = evaluateCtaAction({ refinement: "R2", family: "device-switch", budget: "read-only" }, tracker);
    expect(decision.refuse).toBe(true);
    expect(tracker.usage().size).toBe(0);
  });

  it("allows an R1 config mutation under a guarded budget and reports remaining budget", () => {
    const tracker = new MutationBudgetTracker();
    const decision = evaluateCtaAction(
      { refinement: "R1", family: "config-mutation", budget: "guarded-mutation" },
      tracker,
    );
    expect(decision.refuse).toBe(false);
    expect(decision.remaining).toBe(defaultFamilyBudgets.get("config-mutation")!.maxPerCase - 1);
  });
});

describe("CTA result statuses (Section 5.4)", () => {
  it("only PASS counts as passed coverage", () => {
    expect(isPass("PASS")).toBe(true);
    expect(isPass("BLOCKED")).toBe(false);
    expect(isPass("INCONCLUSIVE")).toBe(false);
    expect(isPass("CALIBRATION_ONLY")).toBe(false);
  });

  it("treats FAIL and BLOCKED as blocking", () => {
    expect(isBlocking("FAIL")).toBe(true);
    expect(isBlocking("BLOCKED")).toBe(true);
    expect(isBlocking("INCONCLUSIVE")).toBe(false);
  });
});

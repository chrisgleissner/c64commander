import { describe, expect, it } from "vitest";
import {
  buildReadOnlyDiscoveryPlan,
  buildRouteDiscoveryPlan,
  checkPreconditions,
  createExplorationTrace,
  defaultExplorationOrder,
  dialogRules,
  getRouteRule,
  listPublicRoutes,
  routeRules,
  shouldRefuseAction,
} from "../src/exploration.js";

describe("route rules (EXP-001)", () => {
  it("defines rules for all seven public routes", () => {
    const routes = routeRules.map((r) => r.route);
    expect(routes).toContain("/");
    expect(routes).toContain("/play");
    expect(routes).toContain("/disks");
    expect(routes).toContain("/config");
    expect(routes).toContain("/settings");
    expect(routes).toContain("/docs");
    expect(routes).toContain("/settings/open-source-licenses");
    expect(routes).toHaveLength(7);
  });

  it("each route has required fields", () => {
    for (const rule of routeRules) {
      expect(rule.route).toBeTruthy();
      expect(rule.label).toBeTruthy();
      expect(rule.actionFamilies.length).toBeGreaterThan(0);
      expect(rule.postconditionStrategy).toBeTruthy();
      expect(rule.recoveryStrategy).toBeTruthy();
      expect(rule.escapeCondition).toBeTruthy();
    }
  });

  it("routes with no preconditions are only Docs and Licenses", () => {
    const noPre = routeRules.filter((r) => r.preconditions.length === 0).map((r) => r.route);
    expect(noPre).toContain("/docs");
    expect(noPre).toContain("/settings/open-source-licenses");
    expect(noPre).toHaveLength(2);
  });

  it("Home route includes machine and config action families", () => {
    const home = getRouteRule("/");
    expect(home).toBeDefined();
    expect(home!.actionFamilies).toContain("Machine controls");
    expect(home!.actionFamilies).toContain("Quick config changes");
  });
});

describe("dialog rules (EXP-001)", () => {
  it("defines all four dialog rules", () => {
    expect(dialogRules.expandOnlyVisible).toBeTruthy();
    expect(dialogRules.closeBeforeRouteChange).toBeTruthy();
    expect(dialogRules.singleSurface).toBeTruthy();
    expect(dialogRules.destructiveCapture).toBeTruthy();
  });
});

describe("exploration helpers (EXP-001 + EXP-003)", () => {
  it("getRouteRule returns rule for known route", () => {
    const rule = getRouteRule("/play");
    expect(rule).toBeDefined();
    expect(rule!.label).toBe("Play");
  });

  it("getRouteRule returns undefined for unknown route", () => {
    expect(getRouteRule("/nonexistent")).toBeUndefined();
  });

  it("listPublicRoutes returns all seven routes", () => {
    const routes = listPublicRoutes();
    expect(routes).toHaveLength(7);
    expect(routes[0]).toBe("/");
  });

  it("shouldRefuseAction allows read-only within read-only budget", () => {
    const result = shouldRefuseAction("read-only", "read-only");
    expect(result.refuse).toBe(false);
  });

  it("shouldRefuseAction refuses guarded in read-only budget", () => {
    const result = shouldRefuseAction("guarded-mutation", "read-only");
    expect(result.refuse).toBe(true);
    expect(result.reason).toContain("guarded-mutation");
    expect(result.reason).toContain("read-only");
  });

  it("shouldRefuseAction refuses destructive in guarded budget", () => {
    const result = shouldRefuseAction("destructive", "guarded-mutation");
    expect(result.refuse).toBe(true);
  });

  it("shouldRefuseAction allows guarded in guarded budget", () => {
    const result = shouldRefuseAction("guarded-mutation", "guarded-mutation");
    expect(result.refuse).toBe(false);
  });

  it("shouldRefuseAction allows all in destructive budget", () => {
    expect(shouldRefuseAction("read-only", "destructive").refuse).toBe(false);
    expect(shouldRefuseAction("guarded-mutation", "destructive").refuse).toBe(false);
    expect(shouldRefuseAction("destructive", "destructive").refuse).toBe(false);
  });

  it("checkPreconditions returns unmet for unknown route", () => {
    const unmet = checkPreconditions("/nonexistent", []);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toContain("Unknown route");
  });

  it("checkPreconditions returns empty for Docs (no preconditions)", () => {
    expect(checkPreconditions("/docs", [])).toHaveLength(0);
  });

  it("checkPreconditions returns unmet preconditions for Home", () => {
    const unmet = checkPreconditions("/", []);
    expect(unmet.length).toBeGreaterThan(0);
    expect(unmet[0]).toContain("Connection state");
  });

  it("checkPreconditions filters out satisfied preconditions", () => {
    const unmet = checkPreconditions("/", ["Connection state is known."]);
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toContain("machine or RAM");
  });
});

describe("exploration order (EXP-001)", () => {
  it("matches the action model default order", () => {
    expect(defaultExplorationOrder[0]).toBe("/");
    expect(defaultExplorationOrder[1]).toBe("/play");
    expect(defaultExplorationOrder[defaultExplorationOrder.length - 1]).toBe("/settings/open-source-licenses");
    expect(defaultExplorationOrder).toHaveLength(7);
  });
});

describe("exploration traces (EXP-004)", () => {
  it("creates a valid trace for a completed action", () => {
    const trace = createExplorationTrace({
      route: "/",
      preconditions: ["Connection state is known."],
      visibleControls: ["Machine controls", "Quick config changes"],
      chosenAction: "Read home page visibility",
      safety: "read-only",
      outcome: "completed",
    });

    expect(trace.route).toBe("/");
    expect(trace.preconditions).toHaveLength(1);
    expect(trace.visibleControls).toHaveLength(2);
    expect(trace.outcome).toBe("completed");
    expect(trace.safety).toBe("read-only");
    expect(trace.cleanupOutcome).toBeNull();
    expect(trace.recordedAt).toBeTruthy();
  });

  it("creates a trace for a refused action", () => {
    const trace = createExplorationTrace({
      route: "/disks",
      preconditions: [],
      visibleControls: ["Delete library entries"],
      chosenAction: "Bulk delete",
      safety: "destructive",
      outcome: "refused",
      cleanupOutcome: "No cleanup needed — action was refused.",
    });

    expect(trace.outcome).toBe("refused");
    expect(trace.safety).toBe("destructive");
    expect(trace.cleanupOutcome).toContain("refused");
  });

  it("creates a trace for a recovered action", () => {
    const trace = createExplorationTrace({
      route: "/play",
      preconditions: ["Source availability is known."],
      visibleControls: ["Source browser"],
      chosenAction: "Open add-items dialog",
      safety: "guarded-mutation",
      outcome: "recovered",
      cleanupOutcome: "Cancelled stale source dialog.",
    });

    expect(trace.outcome).toBe("recovered");
    expect(trace.cleanupOutcome).toContain("Cancelled");
  });

  it("creates a trace for an escaped action", () => {
    const trace = createExplorationTrace({
      route: "/",
      preconditions: ["Safety budget recorded."],
      visibleControls: ["Power controls"],
      chosenAction: "Reset device",
      safety: "destructive",
      outcome: "escaped",
      cleanupOutcome: "Safety budget exhausted.",
    });

    expect(trace.outcome).toBe("escaped");
  });
});

describe("discovery plans (EXP-002 + EXP-003)", () => {
  it("buildReadOnlyDiscoveryPlan covers all public routes", () => {
    const plans = buildReadOnlyDiscoveryPlan();
    expect(plans).toHaveLength(7);
    for (const plan of plans) {
      expect(plan.safety).toBe("read-only");
      expect(plan.expectedControls.length).toBeGreaterThan(0);
    }
  });

  it("buildRouteDiscoveryPlan returns plan for known route", () => {
    const plan = buildRouteDiscoveryPlan("/play", "guarded-mutation");
    expect(plan).toBeDefined();
    expect(plan!.route).toBe("/play");
    expect(plan!.safety).toBe("guarded-mutation");
    expect(plan!.expectedControls.length).toBeGreaterThan(0);
  });

  it("buildRouteDiscoveryPlan returns undefined for unknown route", () => {
    expect(buildRouteDiscoveryPlan("/nonexistent", "read-only")).toBeUndefined();
  });

  it("read-only discovery plan simulates a dry-run route exploration", () => {
    const plans = buildReadOnlyDiscoveryPlan();
    const traces = plans.map((plan) =>
      createExplorationTrace({
        route: plan.route,
        preconditions: [],
        visibleControls: plan.expectedControls,
        chosenAction: `Discover ${plan.label} route shell`,
        safety: plan.safety,
        outcome: "completed",
      }),
    );

    expect(traces).toHaveLength(7);
    for (const trace of traces) {
      expect(trace.outcome).toBe("completed");
      expect(trace.safety).toBe("read-only");
    }
  });
});

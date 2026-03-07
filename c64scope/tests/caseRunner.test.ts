import { describe, expect, it } from "vitest";
import {
  buildReadyCaseSet,
  classifyRunResult,
  evaluateCase,
  isTestOwnedPath,
  resolveCase,
  selectNextCase,
} from "../src/caseRunner.js";
import { caseCatalog, testNamespaces, type CaseDefinition } from "../src/catalog.js";

describe("case runner", () => {
  describe("resolveCase", () => {
    it("resolves a known case by ID", () => {
      const c = resolveCase("nav-route-shell");
      expect(c).toBeDefined();
      expect(c!.id).toBe("nav-route-shell");
      expect(c!.featureArea).toBe("Navigation");
    });

    it("returns undefined for an unknown case ID", () => {
      expect(resolveCase("nonexistent-case")).toBeUndefined();
    });
  });

  describe("evaluateCase", () => {
    it("marks a case ready when dependencies are met", () => {
      const eval1 = evaluateCase("nav-route-shell", new Set());
      expect(eval1.status).toBe("ready");
      expect(eval1.case).toBeDefined();
    });

    it("marks a case blocked-dependency when deps are unmet", () => {
      const eval1 = evaluateCase("nav-connection-status", new Set());
      expect(eval1.status).toBe("blocked-dependency");
      expect(eval1.reason).toContain("nav-route-shell");
    });

    it("marks a case ready once its dependency is completed", () => {
      const eval1 = evaluateCase("nav-connection-status", new Set(["nav-route-shell"]));
      expect(eval1.status).toBe("ready");
    });

    it("marks partial-testability cases as blocked", () => {
      const partialCase = caseCatalog.find((c) => c.testability === "partial");
      if (partialCase) {
        const eval1 = evaluateCase(partialCase.id, new Set());
        expect(eval1.status).toBe("blocked-testability");
        expect(eval1.reason).toContain("partial");
        if (partialCase.blockerRef) {
          expect(eval1.reason).toContain(partialCase.blockerRef);
        }
      }
    });

    it("returns inconclusive for unknown case IDs", () => {
      const eval1 = evaluateCase("unknown-id", new Set());
      expect(eval1.status).toBe("inconclusive");
      expect(eval1.case).toBeUndefined();
    });
  });

  describe("buildReadyCaseSet", () => {
    it("returns ready cases with no completed set", () => {
      const { ready, blocked } = buildReadyCaseSet();
      expect(ready.length).toBeGreaterThan(0);
      expect(blocked.length).toBeGreaterThan(0);

      // Cases with no dependencies should be in ready set
      const noDeps = ready.filter((c) => c.dependencies.length === 0);
      expect(noDeps.length).toBeGreaterThan(0);
    });

    it("excludes already-completed cases", () => {
      const { ready } = buildReadyCaseSet(new Set(["nav-route-shell"]));
      expect(ready.find((c) => c.id === "nav-route-shell")).toBeUndefined();
    });

    it("unblocks dependent cases when deps are completed", () => {
      const withDep = buildReadyCaseSet(new Set());
      const connectionBlocked = withDep.blocked.find((e) => e.caseId === "nav-connection-status");
      expect(connectionBlocked).toBeDefined();
      expect(connectionBlocked!.status).toBe("blocked-dependency");

      const withDepComplete = buildReadyCaseSet(new Set(["nav-route-shell"]));
      const connectionReady = withDepComplete.ready.find((c) => c.id === "nav-connection-status");
      expect(connectionReady).toBeDefined();
    });

    it("sorts ready cases by dependency depth (shallowest first)", () => {
      const { ready } = buildReadyCaseSet();
      for (let i = 1; i < ready.length; i++) {
        expect(ready[i]!.dependencies.length).toBeGreaterThanOrEqual(ready[i - 1]!.dependencies.length);
      }
    });

    it("separates partial/blocked testability cases", () => {
      const { blocked } = buildReadyCaseSet();
      const testabilityBlocked = blocked.filter((e) => e.status === "blocked-testability");
      expect(testabilityBlocked.length).toBeGreaterThan(0);

      for (const tb of testabilityBlocked) {
        const caseDef = resolveCase(tb.caseId);
        expect(caseDef?.testability === "partial" || caseDef?.testability === "blocked").toBe(true);
      }
    });
  });

  describe("selectNextCase", () => {
    it("selects the first ready case with no completed set", () => {
      const next = selectNextCase();
      expect(next.status).toBe("ready");
      expect(next.case).toBeDefined();
      expect(next.case!.dependencies).toHaveLength(0);
    });

    it("selects a deeper case when shallow ones are done", () => {
      const next = selectNextCase(new Set(["nav-route-shell"]));
      expect(next.status).toBe("ready");
    });

    it("returns inconclusive when all cases are done", () => {
      const allIds = new Set(caseCatalog.map((c) => c.id));
      const next = selectNextCase(allIds);
      expect(next.status).toBe("inconclusive");
      expect(next.reason).toContain("No executable cases");
    });
  });

  describe("classifyRunResult", () => {
    it("classifies all-pass as pass", () => {
      const result = classifyRunResult([
        { passed: true, oracleClass: "UI" },
        { passed: true, oracleClass: "REST-visible state" },
      ]);
      expect(result.outcome).toBe("pass");
    });

    it("classifies no assertions as inconclusive", () => {
      const result = classifyRunResult([]);
      expect(result.outcome).toBe("inconclusive");
      expect(result.failureClass).toBe("inconclusive");
    });

    it("classifies UI failure as product_failure", () => {
      const result = classifyRunResult([
        { passed: true, oracleClass: "UI" },
        { passed: false, oracleClass: "UI" },
      ]);
      expect(result.outcome).toBe("fail");
      expect(result.failureClass).toBe("product_failure");
    });

    it("classifies infrastructure-only failures as infrastructure_failure", () => {
      const result = classifyRunResult([
        { passed: true, oracleClass: "UI" },
        { passed: false, oracleClass: "A/V signal" },
      ]);
      expect(result.outcome).toBe("fail");
      expect(result.failureClass).toBe("infrastructure_failure");
    });

    it("classifies mixed failures as product_failure", () => {
      const result = classifyRunResult([
        { passed: false, oracleClass: "UI" },
        { passed: false, oracleClass: "A/V signal" },
      ]);
      expect(result.outcome).toBe("fail");
      expect(result.failureClass).toBe("product_failure");
    });
  });

  describe("isTestOwnedPath", () => {
    it("accepts paths under test namespaces", () => {
      expect(isTestOwnedPath(testNamespaces.androidStaging + "foo.txt")).toBe(true);
      expect(isTestOwnedPath(testNamespaces.c64uDiskPrefix + "game.d64")).toBe(true);
      expect(isTestOwnedPath(testNamespaces.configSnapshotPrefix + "snap1")).toBe(true);
    });

    it("rejects paths outside test namespaces", () => {
      expect(isTestOwnedPath("/sdcard/Download/user-data.txt")).toBe(false);
      expect(isTestOwnedPath("/USB0/user-games/")).toBe(false);
      expect(isTestOwnedPath("my-config")).toBe(false);
    });
  });

  describe("catalog integrity", () => {
    it("every case has required fields", () => {
      for (const c of caseCatalog) {
        expect(c.id).toBeTruthy();
        expect(c.title).toBeTruthy();
        expect(c.featureArea).toBeTruthy();
        expect(c.route).toBeTruthy();
        expect(["read-only", "guarded-mutation", "destructive"].includes(c.safetyClass)).toBe(true);
        expect(c.primaryOracle).toBeTruthy();
        expect(c.fallbackOracle).toBeTruthy();
        expect(c.cleanup).toBeTruthy();
        expect(Array.isArray(c.docRefs)).toBe(true);
        expect(Array.isArray(c.dependencies)).toBe(true);
        expect(["ready", "guarded", "partial", "blocked"].includes(c.testability)).toBe(true);
      }
    });

    it("all dependency references point to existing cases", () => {
      const caseIds = new Set(caseCatalog.map((c) => c.id));
      for (const c of caseCatalog) {
        for (const dep of c.dependencies) {
          expect(caseIds.has(dep)).toBe(true);
        }
      }
    });

    it("no circular dependencies exist", () => {
      const caseMap = new Map(caseCatalog.map((c) => [c.id, c]));

      function hasCycle(id: string, visited: Set<string>, stack: Set<string>): boolean {
        visited.add(id);
        stack.add(id);
        const caseDef = caseMap.get(id);
        if (caseDef) {
          for (const dep of caseDef.dependencies) {
            if (!visited.has(dep)) {
              if (hasCycle(dep, visited, stack)) return true;
            } else if (stack.has(dep)) {
              return true;
            }
          }
        }
        stack.delete(id);
        return false;
      }

      const visited = new Set<string>();
      for (const c of caseCatalog) {
        if (!visited.has(c.id)) {
          expect(hasCycle(c.id, visited, new Set())).toBe(false);
        }
      }
    });

    it("case IDs are unique", () => {
      const ids = caseCatalog.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("partial/blocked cases have blockerRef", () => {
      for (const c of caseCatalog) {
        if (c.testability === "partial" || c.testability === "blocked") {
          expect(c.blockerRef).toBeTruthy();
        }
      }
    });
  });
});

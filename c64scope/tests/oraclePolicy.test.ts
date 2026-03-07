import { describe, expect, it } from "vitest";
import {
  type AssertionRecord,
  checkCorroboration,
  classifyRun,
  detectWeakPatterns,
  oracleClasses,
  weakOraclePatterns,
} from "../src/oraclePolicy.js";

describe("oracle classes (ORC-001)", () => {
  it("defines all 7 oracle classes", () => {
    expect(oracleClasses).toHaveLength(7);
    expect(oracleClasses).toContain("UI");
    expect(oracleClasses).toContain("REST-visible state");
    expect(oracleClasses).toContain("FTP-visible state");
    expect(oracleClasses).toContain("Filesystem-visible state");
    expect(oracleClasses).toContain("Diagnostics and logs");
    expect(oracleClasses).toContain("State refs");
    expect(oracleClasses).toContain("A/V signal");
  });
});

describe("weak oracle detection (ORC-001)", () => {
  it("detects single-toast-success", () => {
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "UI",
        passed: true,
        details: { source: "toast" },
      },
    ];
    const weak = detectWeakPatterns(assertions);
    expect(weak.map((p) => p.id)).toContain("single-toast-success");
  });

  it("detects single-screenshot-no-corroboration", () => {
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "UI",
        passed: true,
        details: { source: "screenshot" },
      },
    ];
    const weak = detectWeakPatterns(assertions);
    expect(weak.map((p) => p.id)).toContain("single-screenshot-no-corroboration");
  });

  it("detects av-only-for-non-playback", () => {
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "A/V signal",
        passed: true,
        details: { featureArea: "Config" },
      },
    ];
    const weak = detectWeakPatterns(assertions);
    expect(weak.map((p) => p.id)).toContain("av-only-for-non-playback");
  });

  it("does not flag av-only when feature area is Play", () => {
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "A/V signal",
        passed: true,
        details: { featureArea: "Play" },
      },
    ];
    const weak = detectWeakPatterns(assertions);
    expect(weak.map((p) => p.id)).not.toContain("av-only-for-non-playback");
  });

  it("detects log-without-context", () => {
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "Diagnostics and logs",
        passed: true,
        details: { correlated: false },
      },
    ];
    const weak = detectWeakPatterns(assertions);
    expect(weak.map((p) => p.id)).toContain("log-without-context");
  });

  it("does not flag correlated log", () => {
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "Diagnostics and logs",
        passed: true,
        details: { correlated: true },
      },
    ];
    const weak = detectWeakPatterns(assertions);
    expect(weak.map((p) => p.id)).not.toContain("log-without-context");
  });

  it("detects crash-absence-as-success", () => {
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "UI",
        passed: true,
        details: { source: "no-crash" },
      },
    ];
    const weak = detectWeakPatterns(assertions);
    expect(weak.map((p) => p.id)).toContain("crash-absence-as-success");
  });

  it("returns empty for strong multi-signal evidence", () => {
    const assertions: AssertionRecord[] = [
      { oracleClass: "UI", passed: true, details: { source: "label" } },
      {
        oracleClass: "REST-visible state",
        passed: true,
        details: {},
      },
    ];
    expect(detectWeakPatterns(assertions)).toHaveLength(0);
  });

  it("defines all 5 weak patterns", () => {
    expect(weakOraclePatterns).toHaveLength(5);
  });
});

describe("pairwise oracle enforcement (ORC-003)", () => {
  it("read-only actions always satisfy corroboration", () => {
    const result = checkCorroboration("read-only", []);
    expect(result.satisfied).toBe(true);
  });

  it("guarded-mutation requires 2 oracle classes", () => {
    const singleOracle: AssertionRecord[] = [{ oracleClass: "UI", passed: true, details: {} }];
    expect(checkCorroboration("guarded-mutation", singleOracle).satisfied).toBe(false);

    const dualOracle: AssertionRecord[] = [
      { oracleClass: "UI", passed: true, details: {} },
      {
        oracleClass: "REST-visible state",
        passed: true,
        details: {},
      },
    ];
    expect(checkCorroboration("guarded-mutation", dualOracle).satisfied).toBe(true);
  });

  it("destructive actions require 2 oracle classes", () => {
    const singleOracle: AssertionRecord[] = [{ oracleClass: "UI", passed: true, details: {} }];
    const result = checkCorroboration("destructive", singleOracle);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("2 independent oracle classes");
  });

  it("multiple assertions from same class count as one", () => {
    const sameClass: AssertionRecord[] = [
      { oracleClass: "UI", passed: true, details: {} },
      { oracleClass: "UI", passed: true, details: {} },
    ];
    expect(checkCorroboration("guarded-mutation", sameClass).satisfied).toBe(false);
  });

  it("failed assertions do not count toward corroboration", () => {
    const mixed: AssertionRecord[] = [
      { oracleClass: "UI", passed: true, details: {} },
      {
        oracleClass: "REST-visible state",
        passed: false,
        details: {},
      },
    ];
    expect(checkCorroboration("guarded-mutation", mixed).satisfied).toBe(false);
  });
});

describe("classification (ORC-004)", () => {
  it("classifies empty assertions as inconclusive", () => {
    const result = classifyRun({
      assertions: [],
      safety: "read-only",
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.failureClass).toBe("inconclusive");
    expect(result.reason).toContain("No assertions");
  });

  it("classifies read-only pass with single strong UI signal", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: true,
          details: { source: "label" },
        },
      ],
      safety: "read-only",
    });
    expect(result.outcome).toBe("pass");
    expect(result.corroborationSatisfied).toBe(true);
  });

  it("rejects weak toast-only pass", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: true,
          details: { source: "toast" },
        },
      ],
      safety: "read-only",
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.weakPatterns).toContain("single-toast-success");
  });

  it("rejects guarded-mutation with single oracle class", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: true,
          details: { source: "label" },
        },
      ],
      safety: "guarded-mutation",
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.corroborationSatisfied).toBe(false);
    expect(result.reason).toContain("2 independent oracle classes");
  });

  it("passes guarded-mutation with two oracle classes", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: true,
          details: { source: "label" },
        },
        {
          oracleClass: "REST-visible state",
          passed: true,
          details: {},
        },
      ],
      safety: "guarded-mutation",
    });
    expect(result.outcome).toBe("pass");
    expect(result.corroborationSatisfied).toBe(true);
  });

  it("classifies infrastructure failure for A/V oracle", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: true,
          details: { source: "label" },
        },
        {
          oracleClass: "A/V signal",
          passed: false,
          details: {},
        },
      ],
      safety: "read-only",
    });
    expect(result.outcome).toBe("fail");
    expect(result.failureClass).toBe("infrastructure_failure");
  });

  it("classifies product failure for UI assertion failure", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: false,
          details: {},
        },
      ],
      safety: "read-only",
    });
    expect(result.outcome).toBe("fail");
    expect(result.failureClass).toBe("product_failure");
  });

  it("classifies product failure for mixed UI + REST failure", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: false,
          details: {},
        },
        {
          oracleClass: "REST-visible state",
          passed: false,
          details: {},
        },
      ],
      safety: "read-only",
    });
    expect(result.outcome).toBe("fail");
    expect(result.failureClass).toBe("product_failure");
  });

  it("classifies infra failure for filesystem + diagnostics failures", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "Filesystem-visible state",
          passed: false,
          details: {},
        },
        {
          oracleClass: "Diagnostics and logs",
          passed: false,
          details: {},
        },
      ],
      safety: "read-only",
    });
    expect(result.outcome).toBe("fail");
    expect(result.failureClass).toBe("infrastructure_failure");
  });

  it("rejects weak A/V-only for Config feature area", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "A/V signal",
          passed: true,
          details: { featureArea: "Config" },
        },
      ],
      safety: "read-only",
    });
    expect(result.outcome).toBe("inconclusive");
    expect(result.weakPatterns).toContain("av-only-for-non-playback");
  });

  it("classifies destructive pass with 3 oracle classes", () => {
    const result = classifyRun({
      assertions: [
        {
          oracleClass: "UI",
          passed: true,
          details: {},
        },
        {
          oracleClass: "REST-visible state",
          passed: true,
          details: {},
        },
        {
          oracleClass: "FTP-visible state",
          passed: true,
          details: {},
        },
      ],
      safety: "destructive",
    });
    expect(result.outcome).toBe("pass");
    expect(result.corroborationSatisfied).toBe(true);
  });
});

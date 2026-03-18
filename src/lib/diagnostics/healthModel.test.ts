import { describe, expect, it } from "vitest";
import {
  deriveAppContributorHealth,
  deriveConnectivityState,
  deriveFtpContributorHealth,
  deriveLastFtpActivity,
  deriveLastRestActivity,
  derivePrimaryProblem,
  deriveRestContributorHealth,
  getBadgeAriaLabel,
  getBadgeLabel,
  getContributorSupportingPhrase,
  HEALTH_GLYPHS,
  rollUpHealth,
  type ContributorHealth,
  type ContributorKey,
} from "@/lib/diagnostics/healthModel";
import type { TraceEvent } from "@/lib/tracing/types";

// Helper to build a minimal TraceEvent at a given offset from now
const makeEvent = (type: TraceEvent["type"], offsetMs: number, data: Record<string, unknown> = {}): TraceEvent => ({
  id: `evt-${Math.random().toString(36).slice(2)}`,
  timestamp: new Date(Date.now() - offsetMs).toISOString(),
  relativeMs: offsetMs,
  type,
  origin: "system",
  correlationId: "test-corr",
  data: {
    lifecycleState: "foreground",
    sourceKind: null,
    localAccessMode: null,
    trackInstanceId: null,
    playlistItemId: null,
    ...data,
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// deriveConnectivityState
// ──────────────────────────────────────────────────────────────────────────────
describe("deriveConnectivityState", () => {
  it("maps REAL_CONNECTED → Online", () => {
    expect(deriveConnectivityState("REAL_CONNECTED")).toBe("Online");
  });

  it("maps DEMO_ACTIVE → Demo", () => {
    expect(deriveConnectivityState("DEMO_ACTIVE")).toBe("Demo");
  });

  it("maps OFFLINE_NO_DEMO → Offline", () => {
    expect(deriveConnectivityState("OFFLINE_NO_DEMO")).toBe("Offline");
  });

  it("maps DISCOVERING → Checking", () => {
    expect(deriveConnectivityState("DISCOVERING")).toBe("Checking");
  });

  it("maps UNKNOWN → Not yet connected", () => {
    expect(deriveConnectivityState("UNKNOWN")).toBe("Not yet connected");
  });

  it("maps unknown string → Not yet connected", () => {
    expect(deriveConnectivityState("WHATEVER")).toBe("Not yet connected");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// HEALTH_GLYPHS
// ──────────────────────────────────────────────────────────────────────────────
describe("HEALTH_GLYPHS", () => {
  it("has a distinct glyph for each health state", () => {
    const glyphs = Object.values(HEALTH_GLYPHS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("contains exactly 5 states", () => {
    expect(Object.keys(HEALTH_GLYPHS)).toHaveLength(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deriveRestContributorHealth
// ──────────────────────────────────────────────────────────────────────────────
describe("deriveRestContributorHealth", () => {
  it("returns Idle when no REST events exist", () => {
    expect(deriveRestContributorHealth([])).toMatchObject({ state: "Idle", problemCount: 0 });
  });

  it("returns Healthy when all REST responses succeed", () => {
    const events = [
      makeEvent("rest-response", 60_000, { status: 200 }),
      makeEvent("rest-response", 30_000, { status: 201 }),
    ];
    expect(deriveRestContributorHealth(events)).toMatchObject({ state: "Healthy", problemCount: 0 });
  });

  it("returns Degraded when ~20–49% of REST responses fail", () => {
    // 1 of 4 = 25%
    const events = [
      makeEvent("rest-response", 60_000, { status: 500 }),
      makeEvent("rest-response", 50_000, { status: 200 }),
      makeEvent("rest-response", 40_000, { status: 200 }),
      makeEvent("rest-response", 30_000, { status: 200 }),
    ];
    expect(deriveRestContributorHealth(events)).toMatchObject({ state: "Degraded", problemCount: 1 });
  });

  it("returns Unhealthy when ≥50% of REST responses fail", () => {
    const events = [
      makeEvent("rest-response", 60_000, { status: 500 }),
      makeEvent("rest-response", 50_000, { status: 500 }),
    ];
    expect(deriveRestContributorHealth(events)).toMatchObject({ state: "Unhealthy", problemCount: 2 });
  });

  it("ignores REST events outside the 5-minute window", () => {
    const oldEvent = makeEvent("rest-response", 6 * 60_000, { status: 500 }); // 6 min old
    expect(deriveRestContributorHealth([oldEvent])).toMatchObject({ state: "Idle" });
  });

  it("treats REST response with error string as failed", () => {
    const events = [makeEvent("rest-response", 30_000, { status: 200, error: "timeout" })];
    expect(deriveRestContributorHealth(events)).toMatchObject({ state: "Unhealthy", problemCount: 1 });
  });

  it("returns Healthy when failure ratio is below 20%", () => {
    // 1 of 7 ≈ 14.3% — below 20% threshold → Healthy (not Degraded)
    const events = [
      makeEvent("rest-response", 60_000, { status: 500 }),
      makeEvent("rest-response", 55_000, { status: 200 }),
      makeEvent("rest-response", 50_000, { status: 200 }),
      makeEvent("rest-response", 45_000, { status: 200 }),
      makeEvent("rest-response", 40_000, { status: 200 }),
      makeEvent("rest-response", 35_000, { status: 200 }),
      makeEvent("rest-response", 30_000, { status: 200 }),
    ];
    expect(deriveRestContributorHealth(events)).toMatchObject({ state: "Healthy" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deriveFtpContributorHealth
// ──────────────────────────────────────────────────────────────────────────────
describe("deriveFtpContributorHealth", () => {
  it("returns Idle when no FTP events exist", () => {
    expect(deriveFtpContributorHealth([])).toMatchObject({ state: "Idle", problemCount: 0 });
  });

  it("returns Healthy when all FTP operations succeed", () => {
    const events = [makeEvent("ftp-operation", 30_000, { result: "success" })];
    expect(deriveFtpContributorHealth(events)).toMatchObject({ state: "Healthy", problemCount: 0 });
  });

  it("returns Unhealthy when ≥50% FTP operations fail", () => {
    const events = [
      makeEvent("ftp-operation", 60_000, { result: "failure" }),
      makeEvent("ftp-operation", 50_000, { result: "failure" }),
    ];
    expect(deriveFtpContributorHealth(events)).toMatchObject({ state: "Unhealthy", problemCount: 2 });
  });

  it("treats FTP event with error string as failed", () => {
    const events = [makeEvent("ftp-operation", 30_000, { result: "success", error: "connection reset" })];
    expect(deriveFtpContributorHealth(events)).toMatchObject({ state: "Unhealthy" });
  });

  it("treats FTP event with non-string result but error string as failed", () => {
    // result is not a string (missing) → null; hasError is true → counted as failed
    const events = [makeEvent("ftp-operation", 30_000, { error: "timeout" })];
    expect(deriveFtpContributorHealth(events)).toMatchObject({ state: "Unhealthy", problemCount: 1 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deriveAppContributorHealth
// ──────────────────────────────────────────────────────────────────────────────
describe("deriveAppContributorHealth", () => {
  it("returns Idle when no error events", () => {
    expect(deriveAppContributorHealth([])).toMatchObject({ state: "Idle", problemCount: 0 });
  });

  it("returns Degraded for 1–4 error events in window", () => {
    const events = [makeEvent("error", 30_000)];
    expect(deriveAppContributorHealth(events)).toMatchObject({ state: "Degraded", problemCount: 1 });
  });

  it("returns Unhealthy for ≥5 error events in window", () => {
    const events = Array.from({ length: 5 }, (_, i) => makeEvent("error", (i + 1) * 10_000));
    expect(deriveAppContributorHealth(events)).toMatchObject({ state: "Unhealthy", problemCount: 5 });
  });

  it("ignores error events outside the 5-minute window", () => {
    const old = makeEvent("error", 6 * 60_000);
    expect(deriveAppContributorHealth([old])).toMatchObject({ state: "Idle" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// rollUpHealth
// ──────────────────────────────────────────────────────────────────────────────
const idleContributor = (): ContributorHealth => ({
  state: "Idle",
  problemCount: 0,
  totalOperations: 0,
  failedOperations: 0,
});

const withState = (state: ContributorHealth["state"]): ContributorHealth => ({
  ...idleContributor(),
  state,
});

const allIdle = (): Record<ContributorKey, ContributorHealth> => ({
  App: idleContributor(),
  REST: idleContributor(),
  FTP: idleContributor(),
});

describe("rollUpHealth", () => {
  it("returns Unavailable when connectivity is Offline", () => {
    expect(rollUpHealth(allIdle(), "Offline")).toBe("Unavailable");
  });

  it("returns Idle when connectivity is Not yet connected", () => {
    const contributors = { App: withState("Healthy"), REST: idleContributor(), FTP: idleContributor() };
    expect(rollUpHealth(contributors, "Not yet connected")).toBe("Idle");
  });

  it("returns Idle when all contributors are Idle", () => {
    expect(rollUpHealth(allIdle(), "Online")).toBe("Idle");
  });

  it("returns Healthy when at least one contributor is Healthy and none are worse", () => {
    const contributors = { App: withState("Healthy"), REST: idleContributor(), FTP: idleContributor() };
    expect(rollUpHealth(contributors, "Online")).toBe("Healthy");
  });

  it("returns Degraded when one contributor is Degraded and none are Unhealthy", () => {
    const contributors = { App: withState("Degraded"), REST: withState("Healthy"), FTP: idleContributor() };
    expect(rollUpHealth(contributors, "Online")).toBe("Degraded");
  });

  it("returns Unhealthy when any contributor is Unhealthy", () => {
    const contributors = { App: withState("Healthy"), REST: withState("Unhealthy"), FTP: idleContributor() };
    expect(rollUpHealth(contributors, "Online")).toBe("Unhealthy");
  });

  it("Unhealthy beats Degraded in roll-up", () => {
    const contributors = { App: withState("Degraded"), REST: withState("Unhealthy"), FTP: withState("Degraded") };
    expect(rollUpHealth(contributors, "Online")).toBe("Unhealthy");
  });

  it("returns Unavailable when any contributor is Unavailable and connectivity is Online", () => {
    const contributors = { App: withState("Unavailable"), REST: idleContributor(), FTP: idleContributor() };
    expect(rollUpHealth(contributors, "Online")).toBe("Unavailable");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deriveLastRestActivity / deriveLastFtpActivity
// ──────────────────────────────────────────────────────────────────────────────
describe("deriveLastRestActivity", () => {
  it("returns null when no REST events", () => {
    expect(deriveLastRestActivity([])).toBeNull();
  });

  it("returns the last REST event", () => {
    const events = [
      makeEvent("rest-response", 60_000, { method: "GET", path: "/v1/info", status: 200 }),
      makeEvent("rest-response", 10_000, { method: "PUT", path: "/v1/machine", status: 204 }),
    ];
    const result = deriveLastRestActivity(events);
    expect(result).not.toBeNull();
    expect(result?.operation).toContain("PUT");
    expect(result?.result).toBe("204");
  });

  it("uses url field when path is missing", () => {
    const events = [makeEvent("rest-response", 5_000, { method: "GET", url: "/v1/version", status: 200 })];
    const result = deriveLastRestActivity(events);
    expect(result?.operation).toContain("/v1/version");
  });

  it("uses fallback strings when REST event data fields are not strings", () => {
    // No method, path, url → uses "REST", "", "", "unknown" fallbacks
    const events = [makeEvent("rest-response", 5_000, {})];
    const result = deriveLastRestActivity(events);
    expect(result?.operation).toBe("REST");
    expect(result?.result).toBe("unknown");
  });
});

describe("deriveLastFtpActivity", () => {
  it("returns null when no FTP events", () => {
    expect(deriveLastFtpActivity([])).toBeNull();
  });

  it("returns the last FTP event", () => {
    const events = [makeEvent("ftp-operation", 30_000, { operation: "LIST", path: "/music", result: "success" })];
    const result = deriveLastFtpActivity(events);
    expect(result).not.toBeNull();
    expect(result?.operation).toContain("LIST");
    expect(result?.result).toBe("success");
  });

  it("uses fallback strings when FTP event data fields are not strings", () => {
    // No operation, path, or result → uses "FTP", "", "ok" fallbacks
    const events = [makeEvent("ftp-operation", 5_000, {})];
    const result = deriveLastFtpActivity(events);
    expect(result?.operation).toBe("FTP");
    expect(result?.result).toBe("ok");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// derivePrimaryProblem
// ──────────────────────────────────────────────────────────────────────────────
describe("derivePrimaryProblem", () => {
  it("returns null when no problems", () => {
    expect(derivePrimaryProblem([], allIdle())).toBeNull();
  });

  it("returns the failed REST event as a problem", () => {
    const events = [makeEvent("rest-response", 10_000, { method: "GET", path: "/v1/machine", status: 500 })];
    const result = derivePrimaryProblem(events, allIdle());
    expect(result).not.toBeNull();
    expect(result?.contributor).toBe("REST");
    expect(result?.title).toContain("failed");
  });

  it("returns the error event as a problem with App contributor", () => {
    const events = [makeEvent("error", 10_000, { message: "Unexpected error" })];
    const result = derivePrimaryProblem(events, allIdle());
    expect(result).not.toBeNull();
    expect(result?.contributor).toBe("App");
  });

  it("uses 'Application error' fallback when error event message is not a string", () => {
    const events = [makeEvent("error", 10_000, { message: 42 })];
    const result = derivePrimaryProblem(events, allIdle());
    expect(result?.title).toBe("Application error");
  });

  it("selects highest-impact problem first (Unhealthy > Degraded)", () => {
    const contributors = {
      App: withState("Unhealthy"),
      REST: withState("Degraded"),
      FTP: idleContributor(),
    };
    const events = [
      makeEvent("rest-response", 20_000, { method: "GET", path: "/rest", status: 500 }),
      makeEvent("error", 10_000, { message: "Critical app error" }),
    ];
    const result = derivePrimaryProblem(events, contributors);
    expect(result?.contributor).toBe("App"); // App is Unhealthy
  });

  it("selects most recent when same impact level", () => {
    const events = [
      makeEvent("rest-response", 30_000, { method: "GET", path: "/older", status: 500 }),
      makeEvent("rest-response", 5_000, { method: "POST", path: "/newer", status: 500 }),
    ];
    const result = derivePrimaryProblem(events, allIdle());
    expect(result?.title).toContain("newer");
  });

  it("returns FTP failure as a problem with FTP contributor", () => {
    const events = [makeEvent("ftp-operation", 10_000, { operation: "STOR", path: "/test.sid", result: "failure" })];
    const result = derivePrimaryProblem(events, allIdle());
    expect(result).not.toBeNull();
    expect(result?.contributor).toBe("FTP");
    expect(result?.title).toContain("failed");
  });

  it("FTP problem with error string sets causeHint", () => {
    const contributors = { App: idleContributor(), REST: idleContributor(), FTP: withState("Unhealthy") };
    const events = [
      makeEvent("ftp-operation", 5_000, {
        operation: "RETR",
        path: "/file.sid",
        result: "failure",
        error: "Connection reset",
      }),
    ];
    const result = derivePrimaryProblem(events, contributors);
    expect(result?.causeHint).toBe("Connection reset");
    expect(result?.impactLevel).toBe(2); // FTP Unhealthy → impactLevel 2
  });

  it("FTP problem with missing operation/path/result uses fallback strings", () => {
    // result is not a string (missing), but hasError is true → enters FTP problem block
    // operation and path are also missing → uses "FTP" and "" fallbacks
    const events = [makeEvent("ftp-operation", 5_000, { error: "timeout" })];
    const result = derivePrimaryProblem(events, allIdle());
    expect(result?.contributor).toBe("FTP");
    expect(result?.title).toContain("FTP");
    expect(result?.causeHint).toBe("timeout");
  });

  it("REST problem sets impactLevel 2 when REST contributor is Unhealthy", () => {
    const contributors = { App: idleContributor(), REST: withState("Unhealthy"), FTP: idleContributor() };
    const events = [makeEvent("rest-response", 10_000, { method: "GET", path: "/v1/info", status: 503 })];
    const result = derivePrimaryProblem(events, contributors);
    expect(result?.impactLevel).toBe(2);
  });

  it("REST problem with missing method/path/status uses fallback strings", () => {
    // status is not a number (missing) but hasError is true → enters problem block
    // method and path are missing → uses "REST" and "" fallbacks
    const events = [makeEvent("rest-response", 5_000, { error: "Network error" })];
    const result = derivePrimaryProblem(events, allIdle());
    expect(result?.contributor).toBe("REST");
    expect(result?.title).toContain("REST");
    expect(result?.causeHint).toBe("Network error");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getBadgeLabel
// ──────────────────────────────────────────────────────────────────────────────
describe("getBadgeLabel", () => {
  const g = HEALTH_GLYPHS.Healthy;

  it("compact — Offline → glyph + Offline", () => {
    const label = getBadgeLabel("Unavailable", "Offline", 0, "compact", HEALTH_GLYPHS.Unavailable);
    expect(label).toBe(`${HEALTH_GLYPHS.Unavailable} Offline`);
  });

  it("expanded — Offline → glyph + Offline · Device not reachable", () => {
    const label = getBadgeLabel("Unavailable", "Offline", 0, "expanded", HEALTH_GLYPHS.Unavailable);
    expect(label).toContain("Device not reachable");
  });

  it("compact — Not yet connected → glyph + —", () => {
    const label = getBadgeLabel("Idle", "Not yet connected", 0, "compact", HEALTH_GLYPHS.Idle);
    expect(label).toBe(`${HEALTH_GLYPHS.Idle} —`);
  });

  it("medium — Not yet connected → glyph + Not connected", () => {
    const label = getBadgeLabel("Idle", "Not yet connected", 0, "medium", HEALTH_GLYPHS.Idle);
    expect(label).toContain("Not connected");
  });

  it("expanded — Not yet connected → glyph + Not yet connected", () => {
    const label = getBadgeLabel("Idle", "Not yet connected", 0, "expanded", HEALTH_GLYPHS.Idle);
    expect(label).toContain("Not yet connected");
  });

  it("medium — Demo connectivity uses Demo label", () => {
    const label = getBadgeLabel("Healthy", "Demo", 0, "medium", HEALTH_GLYPHS.Healthy);
    expect(label).toContain("Demo");
  });

  it("compact — Online + Healthy → glyph + C64U", () => {
    const label = getBadgeLabel("Healthy", "Online", 0, "compact", g);
    expect(label).toBe(`${g} C64U`);
  });

  it("compact — Online + Degraded 3 → glyph + 3 + C64U", () => {
    const label = getBadgeLabel("Degraded", "Online", 3, "compact", HEALTH_GLYPHS.Degraded);
    expect(label).toContain("3");
    expect(label).toContain("C64U");
  });

  it("medium — Online + Unhealthy 5 → count + Unhealthy + C64U", () => {
    const label = getBadgeLabel("Unhealthy", "Online", 5, "medium", HEALTH_GLYPHS.Unhealthy);
    expect(label).toContain("5");
    expect(label).toContain("Unhealthy");
    expect(label).toContain("C64U");
  });

  it("medium — Online + Degraded 3 → Degraded + C64U", () => {
    const label = getBadgeLabel("Degraded", "Online", 3, "medium", HEALTH_GLYPHS.Degraded);
    expect(label).toContain("Degraded");
    expect(label).toContain("C64U");
  });

  it("medium — Online + Healthy → Healthy + C64U", () => {
    const label = getBadgeLabel("Healthy", "Online", 0, "medium", HEALTH_GLYPHS.Healthy);
    expect(label).toContain("Healthy");
    expect(label).toContain("C64U");
  });

  it("medium — Online + Idle → Idle + C64U", () => {
    const label = getBadgeLabel("Idle", "Online", 0, "medium", HEALTH_GLYPHS.Idle);
    expect(label).toContain("Idle");
    expect(label).toContain("C64U");
  });

  it("medium — Checking + Unavailable → ? label", () => {
    const label = getBadgeLabel("Unavailable", "Checking", 0, "medium", HEALTH_GLYPHS.Unavailable);
    expect(label).toContain("?");
  });

  it("expanded — Online + Degraded 2 → spells out problems count", () => {
    const label = getBadgeLabel("Degraded", "Online", 2, "expanded", HEALTH_GLYPHS.Degraded);
    expect(label).toContain("2 problems");
    expect(label).toContain("Degraded");
  });

  it("expanded — Online + Degraded 1 → singular problem", () => {
    const label = getBadgeLabel("Degraded", "Online", 1, "expanded", HEALTH_GLYPHS.Degraded);
    expect(label).toContain("1 problem");
    expect(label).not.toContain("1 problems");
  });

  it("caps count at 99", () => {
    const label = getBadgeLabel("Unhealthy", "Online", 200, "compact", HEALTH_GLYPHS.Unhealthy);
    expect(label).toContain("99");
    expect(label).not.toContain("200");
  });

  it("expanded — Online + Healthy → Healthy label", () => {
    const label = getBadgeLabel("Healthy", "Online", 0, "expanded", HEALTH_GLYPHS.Healthy);
    expect(label).toContain("Healthy");
    expect(label).toContain("C64U");
  });

  it("expanded — Online + Unhealthy → Unhealthy label", () => {
    const label = getBadgeLabel("Unhealthy", "Online", 3, "expanded", HEALTH_GLYPHS.Unhealthy);
    expect(label).toContain("Unhealthy");
    expect(label).toContain("3 problems");
  });

  it("expanded — Online + Idle → Idle label", () => {
    const label = getBadgeLabel("Idle", "Online", 0, "expanded", HEALTH_GLYPHS.Idle);
    expect(label).toContain("Idle");
    expect(label).toContain("C64U");
  });

  it("expanded — Checking + Unavailable → Unavailable label", () => {
    const label = getBadgeLabel("Unavailable", "Checking", 0, "expanded", HEALTH_GLYPHS.Unavailable);
    expect(label).toContain("Unavailable");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getBadgeAriaLabel
// ──────────────────────────────────────────────────────────────────────────────
describe("getBadgeAriaLabel", () => {
  it("Offline → Offline, device not reachable", () => {
    expect(getBadgeAriaLabel("Unavailable", "Offline", 0)).toBe("Offline, device not reachable");
  });

  it("Not yet connected → Not yet connected", () => {
    expect(getBadgeAriaLabel("Idle", "Not yet connected", 0)).toBe("Not yet connected");
  });

  it("Online + Healthy → Connected to C64U, system healthy", () => {
    expect(getBadgeAriaLabel("Healthy", "Online", 0)).toBe("Connected to C64U, system healthy");
  });

  it("Online + Degraded N → includes problem count", () => {
    expect(getBadgeAriaLabel("Degraded", "Online", 3)).toBe("Connected to C64U, system degraded, 3 problems");
  });

  it("Online + Degraded 1 → singular problem", () => {
    expect(getBadgeAriaLabel("Degraded", "Online", 1)).toBe("Connected to C64U, system degraded, 1 problem");
  });

  it("Demo + Unhealthy → Demo mode label", () => {
    expect(getBadgeAriaLabel("Unhealthy", "Demo", 5)).toBe("Demo mode, system unhealthy, 5 problems");
  });

  it("Online + Unhealthy 1 → singular problem", () => {
    expect(getBadgeAriaLabel("Unhealthy", "Online", 1)).toBe("Connected to C64U, system unhealthy, 1 problem");
  });

  it("Online + Idle → Connected to C64U, idle", () => {
    expect(getBadgeAriaLabel("Idle", "Online", 0)).toBe("Connected to C64U, idle");
  });

  it("Online + Unavailable → Connected to C64U, diagnostics unavailable", () => {
    expect(getBadgeAriaLabel("Unavailable", "Online", 0)).toBe("Connected to C64U, diagnostics unavailable");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getContributorSupportingPhrase
// ──────────────────────────────────────────────────────────────────────────────
describe("getContributorSupportingPhrase", () => {
  it("returns Idle for idle contributor", () => {
    expect(getContributorSupportingPhrase("REST", idleContributor())).toBe("Idle");
  });

  it("pluralizes REST requests correctly", () => {
    const h: ContributorHealth = { state: "Degraded", problemCount: 1, totalOperations: 5, failedOperations: 1 };
    expect(getContributorSupportingPhrase("REST", h)).toBe("5 requests, 1 failed");
  });

  it("singularizes REST request when total is 1", () => {
    const h: ContributorHealth = { state: "Unhealthy", problemCount: 1, totalOperations: 1, failedOperations: 1 };
    expect(getContributorSupportingPhrase("REST", h)).toBe("1 request, 1 failed");
  });

  it("uses operations label for FTP", () => {
    const h: ContributorHealth = { state: "Degraded", problemCount: 2, totalOperations: 4, failedOperations: 2 };
    expect(getContributorSupportingPhrase("FTP", h)).toBe("4 operations, 2 failed");
  });

  it("singularizes FTP operation when total is 1", () => {
    const h: ContributorHealth = { state: "Unhealthy", problemCount: 1, totalOperations: 1, failedOperations: 1 };
    expect(getContributorSupportingPhrase("FTP", h)).toBe("1 operation, 1 failed");
  });

  it("uses recent problems label for App", () => {
    const h: ContributorHealth = { state: "Degraded", problemCount: 2, totalOperations: 2, failedOperations: 2 };
    expect(getContributorSupportingPhrase("App", h)).toBe("2 recent problems");
  });

  it("singularizes App problem when count is 1", () => {
    const h: ContributorHealth = { state: "Degraded", problemCount: 1, totalOperations: 1, failedOperations: 1 };
    expect(getContributorSupportingPhrase("App", h)).toBe("1 recent problem");
  });
});

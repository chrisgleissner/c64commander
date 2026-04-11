import { describe, expect, it } from "vitest";
import {
  deriveAppContributorHealth,
  deriveConnectivityState,
  deriveFtpContributorHealth,
  deriveLastFtpActivity,
  deriveLastRestActivity,
  deriveLastTelnetActivity,
  derivePrimaryProblem,
  deriveRestContributorHealth,
  deriveTelnetContributorHealth,
  getBadgeAriaLabel,
  getBadgeLabel,
  getBadgeTextContract,
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

  it("treats event with non-numeric status as success (status becomes null)", () => {
    // status is not a number → status = null → not counted as failed
    const events = [makeEvent("rest-response", 30_000, { status: "200" })];
    expect(deriveRestContributorHealth(events)).toMatchObject({ state: "Healthy", problemCount: 0 });
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
  TELNET: idleContributor(),
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
    const contributors = {
      App: withState("Healthy"),
      REST: withState("Unhealthy"),
      FTP: idleContributor(),
      TELNET: idleContributor(),
    };
    expect(rollUpHealth(contributors, "Online")).toBe("Unhealthy");
  });

  it("Unhealthy beats Degraded in roll-up", () => {
    const contributors = {
      App: withState("Degraded"),
      REST: withState("Unhealthy"),
      FTP: withState("Degraded"),
      TELNET: idleContributor(),
    };
    expect(rollUpHealth(contributors, "Online")).toBe("Unhealthy");
  });

  it("returns Unavailable when any contributor is Unavailable and connectivity is Online", () => {
    const contributors = {
      App: withState("Unavailable"),
      REST: idleContributor(),
      FTP: idleContributor(),
      TELNET: idleContributor(),
    };
    expect(rollUpHealth(contributors, "Online")).toBe("Unavailable");
  });

  it("includes TELNET contributor failures in the overall roll-up", () => {
    const contributors = {
      App: idleContributor(),
      REST: idleContributor(),
      FTP: idleContributor(),
      TELNET: withState("Unhealthy"),
    };
    expect(rollUpHealth(contributors, "Online")).toBe("Unhealthy");
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

describe("deriveTelnetContributorHealth", () => {
  it("returns Idle when no Telnet events exist", () => {
    expect(deriveTelnetContributorHealth([])).toMatchObject({ state: "Idle", problemCount: 0 });
  });

  it("returns Healthy when all Telnet operations succeed", () => {
    const events = [makeEvent("telnet-operation", 30_000, { result: "success" })];
    expect(deriveTelnetContributorHealth(events)).toMatchObject({ state: "Healthy", problemCount: 0 });
  });

  it("returns Unhealthy when Telnet operations fail", () => {
    const events = [makeEvent("telnet-operation", 10_000, { result: "failure", error: "prompt timeout" })];
    expect(deriveTelnetContributorHealth(events)).toMatchObject({ state: "Unhealthy", problemCount: 1 });
  });
});

describe("deriveLastTelnetActivity", () => {
  it("returns null when no Telnet events exist", () => {
    expect(deriveLastTelnetActivity([])).toBeNull();
  });

  it("returns the last Telnet operation", () => {
    const events = [
      makeEvent("telnet-operation", 30_000, { actionLabel: "Reset drive", result: "success" }),
      makeEvent("telnet-operation", 5_000, { actionLabel: "Reboot", result: "failure" }),
    ];
    const result = deriveLastTelnetActivity(events);
    expect(result).not.toBeNull();
    expect(result?.operation).toBe("Reboot");
    expect(result?.result).toBe("failure");
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
      TELNET: idleContributor(),
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
    const contributors = {
      App: idleContributor(),
      REST: idleContributor(),
      FTP: withState("Unhealthy"),
      TELNET: idleContributor(),
    };
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
    const contributors = {
      App: idleContributor(),
      REST: withState("Unhealthy"),
      FTP: idleContributor(),
      TELNET: idleContributor(),
    };
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

  it("returns Telnet failure as a problem with TELNET contributor", () => {
    const contributors = {
      App: idleContributor(),
      REST: idleContributor(),
      FTP: idleContributor(),
      TELNET: withState("Unhealthy"),
    };
    const events = [
      makeEvent("telnet-operation", 5_000, {
        actionLabel: "Save debug log",
        result: "failure",
        error: "menu prompt timeout",
      }),
    ];
    const result = derivePrimaryProblem(events, contributors);
    expect(result?.contributor).toBe("TELNET");
    expect(result?.title).toContain("Save debug log failed");
    expect(result?.impactLevel).toBe(2);
    expect(result?.causeHint).toBe("menu prompt timeout");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getBadgeTextContract / getBadgeLabel
// ──────────────────────────────────────────────────────────────────────────────
describe("getBadgeTextContract", () => {
  const profiles = ["compact", "medium", "expanded"] as const;
  const healthStates = ["Healthy", "Degraded", "Unhealthy", "Idle", "Unavailable"] as const;
  const counts = [0, 1, 12, 999, 1000, 1808] as const;
  const zeroCountSuppressedStates = new Set(["Healthy", "Idle", "Unavailable"]);

  it("applies the shared visible badge contract across profiles, states, and capped counts", () => {
    for (const profile of profiles) {
      for (const health of healthStates) {
        for (const count of counts) {
          const badge = getBadgeTextContract(
            health,
            "Online",
            count,
            profile,
            HEALTH_GLYPHS[health],
            "Ultimate 64 Elite",
          );
          const visibleCount = count === 0 ? null : count > 999 ? "999+" : String(count);

          expect(badge.leadingLabel).toBe("U64E");
          expect(badge.glyph).toBe(HEALTH_GLYPHS[health]);

          if (profile === "compact") {
            expect(badge.countLabel).toBe(visibleCount);
            expect(badge.trailingLabel).toBeNull();
          }

          if (profile === "medium") {
            expect(badge.countLabel).toBe(visibleCount);
            expect(badge.trailingLabel).toBe(health === "Unavailable" ? "?" : health);
          }

          if (profile === "expanded") {
            const expectedSuffix = visibleCount ? `· ${visibleCount} problem${count === 1 ? "" : "s"}` : null;
            const expectedTrailingLabel = expectedSuffix ? `${health} ${expectedSuffix}` : health;

            expect(badge.countLabel).toBeNull();
            expect(badge.trailingLabel).toBe(expectedTrailingLabel);
          }

          if (count === 0 && zeroCountSuppressedStates.has(health)) {
            expect(badge.countLabel).toBeNull();
            expect(badge.trailingLabel?.includes("·")).not.toBe(true);
          }
        }
      }
    }
  });

  it("preserves the demo leading label", () => {
    const badge = getBadgeTextContract("Degraded", "Demo", 12, "medium", HEALTH_GLYPHS.Degraded);

    expect(badge.leadingLabel).toBe("DEMO");
    expect(badge.countLabel).toBe("12");
    expect(badge.trailingLabel).toBe("Degraded");
  });

  it("prefers the explicit connected device label when present", () => {
    const badge = getBadgeTextContract(
      "Healthy",
      "Online",
      0,
      "medium",
      HEALTH_GLYPHS.Healthy,
      "Ultimate 64-II",
      "U64E2",
    );

    expect(badge.leadingLabel).toBe("U64E2");
  });

  it("keeps offline and not-yet-connected visible copy unchanged", () => {
    expect(getBadgeTextContract("Unavailable", "Offline", 1808, "compact", HEALTH_GLYPHS.Unavailable)).toEqual({
      leadingLabel: "Offline",
      glyph: HEALTH_GLYPHS.Unavailable,
      countLabel: null,
      trailingLabel: null,
    });

    expect(getBadgeTextContract("Unavailable", "Offline", 1808, "expanded", HEALTH_GLYPHS.Unavailable)).toEqual({
      leadingLabel: "Offline",
      glyph: HEALTH_GLYPHS.Unavailable,
      countLabel: null,
      trailingLabel: "Device not reachable",
    });

    expect(getBadgeTextContract("Idle", "Not yet connected", 0, "compact", HEALTH_GLYPHS.Idle)).toMatchObject({
      leadingLabel: "—",
      trailingLabel: null,
    });

    expect(getBadgeTextContract("Idle", "Not yet connected", 0, "medium", HEALTH_GLYPHS.Idle)).toMatchObject({
      leadingLabel: "Not connected",
      trailingLabel: null,
    });

    expect(getBadgeTextContract("Idle", "Not yet connected", 0, "expanded", HEALTH_GLYPHS.Idle)).toMatchObject({
      leadingLabel: "Not yet connected",
      trailingLabel: null,
    });
  });
});

describe("getBadgeLabel", () => {
  it("keeps compact output terse", () => {
    expect(getBadgeLabel("Unhealthy", "Online", 1808, "compact", HEALTH_GLYPHS.Unhealthy)).toBe(
      `C64U ${HEALTH_GLYPHS.Unhealthy} 999+`,
    );
  });

  it("includes the health label on medium", () => {
    expect(getBadgeLabel("Unhealthy", "Online", 12, "medium", HEALTH_GLYPHS.Unhealthy)).toBe(
      `C64U ${HEALTH_GLYPHS.Unhealthy} 12 Unhealthy`,
    );
  });

  it("uses the expanded problem suffix only on expanded", () => {
    expect(getBadgeLabel("Degraded", "Online", 1000, "expanded", HEALTH_GLYPHS.Degraded)).toBe(
      `C64U ${HEALTH_GLYPHS.Degraded} Degraded · 999+ problems`,
    );
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

  it("Online aria label uses inferred /v1/info product label", () => {
    expect(getBadgeAriaLabel("Healthy", "Online", 0, "Ultimate 64-II")).toBe("Connected to U64E2, system healthy");
  });

  it("Online aria label prefers the resolved saved-device label when provided", () => {
    expect(getBadgeAriaLabel("Healthy", "Online", 0, "Ultimate 64-II", "C64U-2")).toBe(
      "Connected to C64U-2, system healthy",
    );
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

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clearRecoveryEvidence, getRecoveryEvidence, recordRecoveryEvidence } from "@/lib/diagnostics/recoveryEvidence";

beforeEach(() => {
  clearRecoveryEvidence();
});

describe("recoveryEvidence", () => {
  it("records recovery events in insertion order with generated ids", () => {
    const first = recordRecoveryEvidence({
      kind: "retry-connection",
      outcome: "success",
      contributor: "REST",
      target: "c64u.local",
      message: "Connected to c64u.local",
    });

    const second = recordRecoveryEvidence({
      kind: "switch-device",
      outcome: "failure",
      contributor: "REST",
      target: "192.168.1.42:80",
      message: "Could not reach 192.168.1.42:80",
    });

    expect(first.id).toMatch(/^recovery-/);
    expect(second.id).toMatch(/^recovery-/);
    expect(getRecoveryEvidence().map((entry) => entry.kind)).toEqual(["retry-connection", "switch-device"]);
  });

  it("clears all recovery evidence", () => {
    recordRecoveryEvidence({
      kind: "health-check",
      outcome: "failure",
      contributor: "App",
      target: "c64u.local",
      message: "Health check Unhealthy",
    });

    clearRecoveryEvidence();
    expect(getRecoveryEvidence()).toEqual([]);
  });

  it("evicts the oldest entry when MAX_RECOVERY_EVENTS (500) is reached", () => {
    const base = {
      kind: "health-check" as const,
      outcome: "success" as const,
      contributor: "App" as const,
      target: "c64u.local",
    };
    for (let i = 0; i < 500; i++) {
      recordRecoveryEvidence({ ...base, message: `event-${i}` });
    }
    expect(getRecoveryEvidence()).toHaveLength(500);

    recordRecoveryEvidence({ ...base, message: "event-500" });
    const evidence = getRecoveryEvidence();
    expect(evidence).toHaveLength(500);
    expect(evidence[499].message).toBe("event-500");
    expect(evidence[0].message).toBe("event-1");
  });
});

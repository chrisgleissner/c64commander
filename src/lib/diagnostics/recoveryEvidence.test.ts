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
});

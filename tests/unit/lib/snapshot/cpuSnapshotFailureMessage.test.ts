/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { CpuCaptureFailedError } from "@/lib/snapshot/cpu/captureEngine";
import { describeCpuSnapshotFailure } from "@/lib/snapshot/cpuSnapshotFailureMessage";
import { CpuSnapshotUnsupportedError } from "@/lib/snapshot/snapshotCreation";

describe("describeCpuSnapshotFailure", () => {
  it("names every reason an interrupt can fail to reach the hook, without asserting one", () => {
    const message = describeCpuSnapshotFailure(new CpuCaptureFailedError("none fired", "no-interrupt"));

    expect(message).toBe(
      "Couldn't capture the CPU state: no interrupt reached the capture hook. This happens when the running program " +
        "disables interrupts, uses interrupt vectors of its own, or runs from a cartridge. " +
        "Use a Program or Basic RAM snapshot instead.",
    );
  });

  it("says the registers were unstable, not that interrupts were disabled, when the read-back differed", () => {
    const message = describeCpuSnapshotFailure(new CpuCaptureFailedError("not stable", "unstable-registers"));

    expect(message).toContain("the saved registers changed between two reads");
    expect(message).not.toContain("interrupt");
  });

  it("blames the missing device information, not the program, when the capability check failed", () => {
    const message = describeCpuSnapshotFailure(new CpuSnapshotUnsupportedError("/v1/info unavailable: timeout"));

    expect(message).toBe(
      "Couldn't capture the CPU state: the C64 did not report its device information " +
        "(/v1/info unavailable: timeout). Use a Program or Basic RAM snapshot instead.",
    );
  });

  it("leaves unrelated errors to the caller", () => {
    expect(describeCpuSnapshotFailure(new Error("disk full"))).toBeNull();
  });
});

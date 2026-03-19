/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isRecoveryFirstState } from "@/components/diagnostics/ConnectionActionsRegion";

describe("isRecoveryFirstState", () => {
  it("treats demo mode as recovery-first so switching to real hardware stays prominent", () => {
    expect(isRecoveryFirstState("Demo")).toBe(true);
  });

  it("keeps online mode collapsed unless there was a recent failure", () => {
    expect(isRecoveryFirstState("Online")).toBe(false);
    expect(isRecoveryFirstState("Online", true)).toBe(true);
  });
});

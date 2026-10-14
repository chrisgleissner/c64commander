/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  BACKGROUND_ADVANCE_LOG_MESSAGES,
  resolveBackgroundAdvanceOutcome,
} from "@/pages/playFiles/backgroundAdvanceOutcome";

describe("resolveBackgroundAdvanceOutcome", () => {
  it("reports no guard when the advance left nothing to watch", () => {
    expect(resolveBackgroundAdvanceOutcome(3, null)).toBe("no-guard");
  });

  it("reports moved-on when a different track instance holds the guard", () => {
    expect(resolveBackgroundAdvanceOutcome(3, { trackInstanceId: 4, autoFired: false })).toBe("moved-on");
  });

  it("reports in-flight, not stuck, when the same track's end was already claimed by another advance", () => {
    expect(resolveBackgroundAdvanceOutcome(3, { trackInstanceId: 3, autoFired: true })).toBe("in-flight");
  });

  it("reports stuck only when the same track is still on screen and nothing claimed its end", () => {
    expect(resolveBackgroundAdvanceOutcome(3, { trackInstanceId: 3, autoFired: false })).toBe("stuck");
  });

  it("keeps the warning text for the stuck case only", () => {
    expect(BACKGROUND_ADVANCE_LOG_MESSAGES.stuck).toContain("did not move to a new track instance");
    expect(BACKGROUND_ADVANCE_LOG_MESSAGES["in-flight"]).not.toContain("did not move");
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { decideConfigPulseRevert } from "@/lib/diagnostics/configPulseRevert";

const base = { originalValue: 5, tempValue: 21 };

describe("decideConfigPulseRevert", () => {
  it("reverts only when the value read just before the revert is the pulse value", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: 21 })).toBe("revert");
    expect(decideConfigPulseRevert({ ...base, readBackValue: null, preRevertValue: 21 })).toBe("revert");
  });

  it("treats another value read before the revert as another client's write, even when the readback missed it", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: 9 })).toBe("external-write");
    expect(decideConfigPulseRevert({ ...base, readBackValue: 9, preRevertValue: 9 })).toBe("external-write");
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: 5 })).toBe("external-write");
  });

  it("reports a pulse that never took effect when the original value is still present", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 5, preRevertValue: 5 })).toBe("not-applied");
    expect(decideConfigPulseRevert({ ...base, readBackValue: null, preRevertValue: 5 })).toBe("not-applied");
  });

  it("reports an unknown value when the read before the revert produced no number", () => {
    expect(decideConfigPulseRevert({ ...base, readBackValue: 21, preRevertValue: null })).toBe("unknown");
  });
});

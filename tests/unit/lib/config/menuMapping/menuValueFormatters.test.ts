/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { formatCpuSpeedMhz, getMenuValueFormatter } from "@/lib/config/menuMapping/menuValueFormatters";

describe("menuValueFormatters", () => {
  it("reuses formatDbValue: trims the padded ' 0 dB' and signs positives", () => {
    const db = getMenuValueFormatter("db")!;
    expect(db(" 0 dB")).toBe("0 dB");
    expect(db("+6 dB")).toBe("+6 dB");
    expect(db("-15 dB")).toBe("-15 dB");
  });

  it("reuses formatPanValue", () => {
    const pan = getMenuValueFormatter("pan")!;
    expect(pan("Center")).toBe("C");
    expect(pan("Left 3")).toBe("L 3");
    expect(pan("Right 2")).toBe("R 2");
  });

  it("reuses formatAddressValue ($XXXX / Unmapped)", () => {
    const address = getMenuValueFormatter("address")!;
    expect(address("$D400")).toBe("$D400");
    expect(address("d700")).toBe("$D700");
    expect(address("")).toBe("Unmapped");
  });

  it("appends MHz to bare/padded CPU speed options without mutating identity", () => {
    expect(formatCpuSpeedMhz(" 1")).toBe("1 MHz");
    expect(formatCpuSpeedMhz("2")).toBe("2 MHz");
    expect(formatCpuSpeedMhz("48")).toBe("48 MHz");
    // non-numeric passthrough (trimmed)
    expect(formatCpuSpeedMhz(" Turbo ")).toBe("Turbo");
  });

  it("returns undefined for unknown / missing formatter ids", () => {
    expect(getMenuValueFormatter(undefined)).toBeUndefined();
    expect(getMenuValueFormatter("nope")).toBeUndefined();
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SectionHeader } from "@/components/SectionHeader";
import { guidanceLabelFor } from "@/lib/input/guidance";

describe("SectionHeader", () => {
  it("names its Reset button by the card it resets, so the guidance bar does not read only Reset", () => {
    render(<SectionHeader title="Drives" hideTitle resetAction={vi.fn()} resetTestId="drives-reset" />);
    expect(guidanceLabelFor(screen.getByTestId("drives-reset"))).toBe("Drives: reset");
  });

  it("says the card is resetting while it is", () => {
    render(<SectionHeader title="Printers" resetAction={vi.fn()} isResetting resetTestId="printers-reset" />);
    expect(guidanceLabelFor(screen.getByTestId("printers-reset"))).toBe("Printers: resetting");
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { headerFitsOneRow } from "@/components/useHeaderActionsFit";

const widths = (available: number) => ({
  available,
  toggleChrome: 40,
  title: 60,
  actions: 100,
  chevron: 44,
  rowChrome: 16,
});

describe("headerFitsOneRow", () => {
  it("fits when the row has room to spare", () => {
    expect(headerFitsOneRow(widths(300))).toBe(true);
  });

  it("stacks a header measured to fit with no room to spare, so a font difference cannot cut its title", () => {
    expect(headerFitsOneRow(widths(260))).toBe(false);
    expect(headerFitsOneRow(widths(262))).toBe(false);
  });

  it("stacks a header that is too wide", () => {
    expect(headerFitsOneRow(widths(200))).toBe(false);
  });
});

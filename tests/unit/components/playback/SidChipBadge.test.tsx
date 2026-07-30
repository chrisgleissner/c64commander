/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidChipBadge } from "@/components/playback/SidChipBadge";

describe("SidChipBadge", () => {
  it.each([
    [2, "2SID", "Plays through two SID chips"],
    [3, "3SID", "Plays through three SID chips"],
    [4, "4SID", "Plays through four SID chips"],
  ] as const)("renders %i chips as %s", (chipCount, label, description) => {
    render(<SidChipBadge chipCount={chipCount} />);
    const badge = screen.getByTestId(`sid-chip-badge-${chipCount}`);
    expect(badge).toHaveTextContent(label);
    // The numeral is decorative to a screen reader — "2SID" read aloud is not a sentence — so the
    // badge carries the spoken form on itself instead.
    expect(badge).toHaveAccessibleName(description);
  });

  it("is plain text with no icon beside it", () => {
    // The badge used to carry a drawn SID chip. It was not legible at this size, so it went; an icon
    // creeping back in is the regression this guards.
    const { container } = render(<SidChipBadge chipCount={2} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("sid-chip-badge-2").textContent).toBe("2SID");
  });

  it("is set large enough to read rather than shrunk into chrome", () => {
    // A rare marker can afford presence. `text-xs` matches the row's own companion text; the earlier
    // `text-[10px]` was smaller than everything around it and the owner could not read it.
    render(<SidChipBadge chipCount={3} />);
    const badge = screen.getByTestId("sid-chip-badge-3");
    expect(badge.className).toContain("text-xs");
    expect(badge.className).toContain("text-primary");
    expect(badge.className).not.toContain("text-[10px]");
    // No border: the tinted ground is the whole treatment.
    expect(badge.className).not.toMatch(/(^|\s)border($|\s)/);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("reports its value to assistive technology", () => {
    render(<Progress value={40} aria-label="Playback progress" />);
    const bar = screen.getByRole("progressbar", { name: "Playback progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("data-state", "loading");
  });

  it("clamps a value outside 0-100 instead of passing it through", () => {
    render(<Progress value={140} aria-label="Overfull" />);
    expect(screen.getByRole("progressbar", { name: "Overfull" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("stays indeterminate without a value", () => {
    render(<Progress aria-label="Waiting" />);
    const bar = screen.getByRole("progressbar", { name: "Waiting" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("data-indeterminate", "true");
  });
});

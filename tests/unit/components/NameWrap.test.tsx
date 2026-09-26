/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NameWrap, splitNameAtSeparators } from "@/components/NameWrap";

describe("splitNameAtSeparators", () => {
  it.each([
    ["Turrican_(Original)_S1.d64", ["Turrican_", "(Original)_", "S1.", "d64"]],
    ["Game-Disk1.d64", ["Game-", "Disk1.", "d64"]],
    ["/.../Katakis.d81", ["/.../", "Katakis.", "d81"]],
    ["Last Ninja 2 side A.d64", ["Last Ninja 2 side A.", "d64"]],
    ["Katakis", ["Katakis"]],
    ["", []],
  ])("splits %s after each run of separators", (name, expected) => {
    expect(splitNameAtSeparators(name)).toEqual(expected);
  });
});

describe("NameWrap", () => {
  it("offers a line break after each separator run while keeping the name's text intact", () => {
    const { container } = render(<NameWrap name="Turrican_(Original)_S1.d64" />);
    expect(screen.getByText("Turrican_(Original)_S1.d64")).toBeInTheDocument();
    expect(container.querySelectorAll("wbr")).toHaveLength(3);
  });
});

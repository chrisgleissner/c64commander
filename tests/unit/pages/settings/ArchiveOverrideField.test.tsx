/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArchiveOverrideField } from "@/pages/settings/ArchiveOverrideField";

const longHost = "a-very-long-archive-host-name.example.commodore.invalid";

describe("ArchiveOverrideField", () => {
  it("prints the value in use in full instead of squeezing it into the placeholder", () => {
    render(
      <ArchiveOverrideField
        id="archive-host-override"
        label="Host override"
        value=""
        onChange={vi.fn()}
        effectiveValue={longHost}
      />,
    );

    expect(screen.getByTestId("archive-host-override")).toHaveAttribute("placeholder", "Default");
    expect(screen.getByTestId("archive-host-override-effective")).toHaveTextContent(`In use: ${longHost}`);
  });

  it("reports edits and links the field to its error", () => {
    const onChange = vi.fn();
    render(
      <ArchiveOverrideField
        id="archive-host-override"
        label="Host override"
        value=""
        onChange={onChange}
        effectiveValue="host"
        error="Not a hostname"
      />,
    );

    fireEvent.change(screen.getByTestId("archive-host-override"), { target: { value: "x" } });

    expect(onChange).toHaveBeenCalledWith("x");
    expect(screen.getByRole("alert")).toHaveTextContent("Not a hostname");
    expect(screen.getByTestId("archive-host-override")).toHaveAttribute(
      "aria-describedby",
      "archive-host-override-error",
    );
  });
});

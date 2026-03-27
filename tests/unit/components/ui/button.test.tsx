/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatefulButton } from "@/components/ui/button";

describe("StatefulButton", () => {
  it("renders a native button and forwards clicks", () => {
    const onClick = vi.fn();

    render(<StatefulButton onClick={onClick}>Press</StatefulButton>);

    fireEvent.click(screen.getByRole("button", { name: "Press" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the child element when asChild is enabled", () => {
    render(
      <StatefulButton asChild variant="link">
        <a href="/docs">Docs</a>
      </StatefulButton>,
    );

    const link = screen.getByRole("link", { name: "Docs" });

    expect(link).toHaveAttribute("href", "/docs");
    expect(link.className).toContain("underline-offset-4");
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

describe("SheetContent", () => {
  it("offsets a bottom sheet above the navigation bar once, not again in its padding", () => {
    // The standard sheet added both insets to its padding as well, which on a Pixel 4 left the
    // keyboard-shortened Find a tune list about one result row.
    render(
      <Sheet open>
        <SheetContent side="bottom" data-testid="sheet">
          <SheetTitle>Find a tune</SheetTitle>
          <SheetDescription>Search</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    const className = screen.getByTestId("sheet").className;
    expect(className).toContain("bottom-[var(--safe-area-inset-bottom)]");
    expect(className).not.toMatch(/p[tb]-\[calc\([^\]]*safe-area-inset/);
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const profileRef = vi.hoisted(() => ({ current: "medium" as "compact" | "medium" | "expanded" }));
vi.mock("@/hooks/useDisplayProfile", () => ({ useDisplayProfile: () => ({ profile: profileRef.current }) }));

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

describe("SheetContent", () => {
  beforeEach(() => {
    profileRef.current = "medium";
  });

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

  /*
   * On the smallest screen the sheet was allowed the whole screen height while standing on the
   * navigation bar, so on a Pixel 4 it reached 48px above the top of the screen and SID Radio's title
   * and Close sat under the status bar.
   */
  it("keeps a compact bottom sheet between the status bar and the navigation bar", () => {
    profileRef.current = "compact";
    render(
      <Sheet open>
        <SheetContent side="bottom" data-testid="sheet">
          <SheetTitle>SID Radio</SheetTitle>
          <SheetDescription>Stations</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    const className = screen.getByTestId("sheet").className;
    expect(className).toContain("bottom-[var(--safe-area-inset-bottom)]");
    expect(className).toContain("max-h-[calc(100dvh-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))]");
    expect(className).not.toContain("max-h-[100dvh]");
    expect(className).not.toMatch(/p[tb]-\[calc\([^\]]*safe-area-inset/);
  });
});

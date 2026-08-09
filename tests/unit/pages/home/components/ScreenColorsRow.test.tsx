/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sheet: vi.fn(),
}));

// The sheet is covered by its own test and pulls in the whole device-palette stack; here only the
// fact that the row opens it matters.
vi.mock("@/components/palette/ScreenColorsSheet", () => ({
  ScreenColorsSheet: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
    mocks.sheet({ open });
    return (
      <div data-testid="screen-colors-sheet" data-open={String(open)}>
        <button type="button" data-testid="screen-colors-sheet-close" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    );
  },
}));

import { ScreenColorsRow } from "@/pages/home/components/ScreenColorsRow";
import { saveVicPaletteId } from "@/lib/config/appSettings";
import { DEVICE_VIC_PALETTE_ID, __resetVicPalette, setActiveVicPalette } from "@/lib/streams/vicPalette";

describe("ScreenColorsRow", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("names the palette the app is painting with", () => {
    saveVicPaletteId("night");
    render(<ScreenColorsRow />);

    expect(screen.getByTestId("home-video-screen-colors")).toHaveTextContent("Night");
    expect(screen.queryByTestId("home-video-screen-colors-following")).toBeNull();
  });

  it("says where the palette came from while following the machine", () => {
    saveVicPaletteId(DEVICE_VIC_PALETTE_ID);
    render(<ScreenColorsRow focusParentId="home-video" focusOrder={2} focusGroup="home-video-controls" />);

    // Following resolves to whatever the app has been told the machine renders, which starts as the
    // reference palette. Where it came from sits on its own line, so a narrow screen truncates the
    // palette's name rather than the fact that it is the machine's.
    expect(screen.getByTestId("home-video-screen-colors")).toHaveTextContent("Default");
    expect(screen.getByTestId("home-video-screen-colors-following")).toHaveTextContent("Following the C64");
  });

  it("follows the painted palette when it changes", () => {
    saveVicPaletteId("cool");
    render(<ScreenColorsRow />);
    expect(screen.getByTestId("home-video-screen-colors")).toHaveTextContent("Cool");

    act(() => setActiveVicPalette("monochrome"));

    expect(screen.getByTestId("home-video-screen-colors")).toHaveTextContent("Monochrome");
  });

  it("previews the palette with its sixteen swatches", () => {
    saveVicPaletteId("cool");
    render(<ScreenColorsRow />);

    const strip = screen.getByTestId("home-video-screen-colors-preview");
    expect(strip.children).toHaveLength(16);
    expect(strip).toHaveAttribute("aria-label", "Cool palette, sixteen colors");
  });

  it("opens the sheet when the row is tapped, and closes it again", () => {
    render(<ScreenColorsRow />);
    // Not merely closed — absent. The sheet reads the machine's palette list, so Home must not
    // mount it, or run the hooks behind it, for a row nobody has tapped.
    expect(screen.queryByTestId("screen-colors-sheet")).toBeNull();

    fireEvent.click(screen.getByTestId("home-video-screen-colors"));
    expect(screen.getByTestId("screen-colors-sheet")).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByTestId("screen-colors-sheet-close"));
    expect(screen.queryByTestId("screen-colors-sheet")).toBeNull();
  });
});

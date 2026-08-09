/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: "medium" }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select aria-label="Screen colours" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { VicPaletteRow } from "@/pages/settings/VicPaletteRow";
import {
  __resetVicPalette,
  DEVICE_VIC_PALETTE_ID,
  setActiveVicPalette,
  setActiveVicPaletteDefinition,
} from "@/lib/streams/vicPalette";

describe("VicPaletteRow", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
  });

  it("shows automatic device palette as the default and lets the user choose a bundled palette", () => {
    render(<VicPaletteRow />);

    expect(screen.getByRole("option", { name: "Device palette (automatic)" })).toHaveValue(DEVICE_VIC_PALETTE_ID);
    expect(screen.getByTestId("settings-vic-palette-description")).toHaveTextContent("C64 Ultimate Default Palette");

    fireEvent.change(screen.getByLabelText("Screen colours"), { target: { value: "monochrome" } });

    expect(localStorage.getItem("c64u_vic_palette")).toBe("monochrome");
    expect(screen.getByTestId("settings-vic-palette-description")).toHaveTextContent("Classic monochrome");
  });

  it("updates the preview from a device palette and omits a missing description", () => {
    setActiveVicPaletteDefinition({
      id: "device:/Usb0/untitled.vpl",
      name: "Untitled device palette",
      description: "",
      rgb: Array.from({ length: 16 }, (_, index) => [index, index + 1, index + 2]),
    });
    render(<VicPaletteRow />);

    expect(screen.getByTestId("settings-vic-palette-swatch-2")).toHaveStyle({ background: "#020304" });
    expect(screen.queryByTestId("settings-vic-palette-description")).not.toBeInTheDocument();
  });

  it("switches back to automatic mode without replacing the active device palette", () => {
    setActiveVicPalette("monochrome");
    render(<VicPaletteRow />);

    fireEvent.change(screen.getByLabelText("Screen colours"), { target: { value: DEVICE_VIC_PALETTE_ID } });

    expect(localStorage.getItem("c64u_vic_palette")).toBe(DEVICE_VIC_PALETTE_ID);
    expect(screen.getByTestId("settings-vic-palette-description")).toHaveTextContent("Classic monochrome");
  });
});

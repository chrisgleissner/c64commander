/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VicPalette } from "@/generated/vicPalettes";
import type { PaletteTarget } from "@/lib/config/appSettings";

const mocks = vi.hoisted(() => ({
  useScreenColors: vi.fn(),
  addLog: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/useScreenColors", () => ({
  useScreenColors: mocks.useScreenColors,
}));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mocks.toast,
}));

import { ScreenColorsSheet } from "@/components/palette/ScreenColorsSheet";
import { VIC_PALETTES } from "@/lib/streams/vicPalette";

const COOL = VIC_PALETTES.find((palette) => palette.id === "cool")!;

/** A palette read off the machine: a filename for a name, and no description to show. */
const installed: VicPalette = {
  id: "mine",
  name: "a-very-long-palette-filename.vpl",
  description: "",
  rgb: COOL.rgb,
};

type HookState = ReturnType<typeof baseState>;

const baseState = () => ({
  apply: vi.fn<(palette: VicPalette) => Promise<boolean>>().mockResolvedValue(true),
  applying: null as string | null,
  builtInPalettes: VIC_PALETTES,
  devicePalettes: [] as VicPalette[],
  devicePalettesLoading: false,
  following: false,
  followDevice: vi.fn(),
  selectedId: "cool" as string,
  setTarget: vi.fn(),
  target: "local" as PaletteTarget,
  painted: COOL,
  deviceFilename: "",
  isOnDevice: vi.fn<(palette: VicPalette) => boolean>().mockReturnValue(false),
  installedFilenames: [] as string[],
});

const setup = (overrides: Partial<HookState> = {}) => {
  const state = { ...baseState(), ...overrides };
  mocks.useScreenColors.mockReturnValue(state);
  const onOpenChange = vi.fn();
  render(<ScreenColorsSheet open onOpenChange={onOpenChange} />);
  return { state, onOpenChange };
};

describe("ScreenColorsSheet", () => {
  beforeEach(() => {
    mocks.useScreenColors.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("only reads the palettes while it is open", () => {
    setup();
    expect(mocks.useScreenColors).toHaveBeenCalledWith({ enabled: true });
  });

  it("lists every built-in palette with its swatches", () => {
    setup();
    for (const palette of VIC_PALETTES) {
      expect(screen.getByTestId(`screen-colors-palette-${palette.id}`)).toHaveTextContent(palette.name);
      expect(screen.getByTestId(`screen-colors-palette-${palette.id}-strip`)).toBeInTheDocument();
    }
  });

  it("marks the chosen palette as pressed and leaves the others alone", () => {
    setup({ selectedId: "night" });
    expect(screen.getByTestId("screen-colors-palette-night")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("screen-colors-palette-cool")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("screen-colors-follow-device")).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the follow row as pressed while following, and no palette with it", () => {
    setup({ following: true, selectedId: "device" });
    expect(screen.getByTestId("screen-colors-follow-device")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("screen-colors-palette-cool")).toHaveAttribute("aria-pressed", "false");
  });

  it("hands the choice back to the machine when the follow row is clicked", () => {
    const { state } = setup();
    fireEvent.click(screen.getByTestId("screen-colors-follow-device"));
    expect(state.followDevice).toHaveBeenCalledTimes(1);
  });

  describe("the target toggle", () => {
    it("presses the button for the current target", () => {
      setup({ target: "remote" });
      expect(screen.getByTestId("screen-colors-local")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("screen-colors-remote")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("screen-colors-both")).toHaveAttribute("aria-pressed", "false");
    });

    it.each([
      ["screen-colors-local", "local"],
      ["screen-colors-remote", "remote"],
      ["screen-colors-both", "both"],
    ])("passes %s through as the new target", (testId, expected) => {
      const { state } = setup({ target: "both" });
      fireEvent.click(screen.getByTestId(testId));
      expect(state.setTarget).toHaveBeenCalledWith(expected);
    });

    it.each([
      ["local", "The C64 is not touched"],
      ["remote", "so the television changes too"],
      ["both", "Changes both this device's Live View"],
    ])("explains what %s does", (target, hint) => {
      setup({ target: target as PaletteTarget });
      expect(screen.getByTestId("screen-colors-target-hint")).toHaveTextContent(hint);
    });

    it("hides the install note for a local-only choice and shows it otherwise", () => {
      setup({ target: "local" });
      expect(screen.queryByTestId("screen-colors-install-note")).not.toBeInTheDocument();
    });

    it.each(["remote", "both"])("shows the install note for %s", (target) => {
      setup({ target: target as PaletteTarget });
      expect(screen.getByTestId("screen-colors-install-note")).toHaveTextContent(
        "Keep device settings after a restart",
      );
    });
  });

  describe("choosing a palette", () => {
    it("applies it without announcing anything when the target is local", async () => {
      const { state } = setup({ target: "local" });
      fireEvent.click(screen.getByTestId("screen-colors-palette-cool"));

      await waitFor(() => expect(state.apply).toHaveBeenCalledWith(COOL));
      expect(mocks.toast).not.toHaveBeenCalled();
    });

    it("announces the change when it reached the machine", async () => {
      setup({ target: "both" });
      fireEvent.click(screen.getByTestId("screen-colors-palette-cool"));

      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Cool applied to the C64" }));
    });

    it("reports and logs a failed apply", async () => {
      const apply = vi.fn().mockRejectedValue(new Error("device refused"));
      setup({ target: "remote", apply });
      fireEvent.click(screen.getByTestId("screen-colors-palette-cool"));

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith({
          title: "Could not change the C64's colors",
          description: "device refused",
          variant: "destructive",
        }),
      );
      expect(mocks.addLog).toHaveBeenCalledWith("warn", "Could not change the C64's palette", {
        palette: "cool",
        message: "device refused",
      });
    });

    it("disables the row it is applying and leaves the rest usable", () => {
      setup({ target: "remote", applying: "cool" });
      expect(screen.getByTestId("screen-colors-palette-cool")).toBeDisabled();
      expect(screen.getByTestId("screen-colors-palette-night")).not.toBeDisabled();
    });
  });

  describe("the palettes already on the machine", () => {
    it("is not shown at all when the machine has none", () => {
      setup();
      expect(screen.queryByTestId("screen-colors-device-palettes")).not.toBeInTheDocument();
    });

    it("says it is reading while the files are being fetched", () => {
      setup({ devicePalettesLoading: true });
      expect(screen.getByTestId("screen-colors-device-palettes")).toHaveTextContent("Reading…");
      expect(screen.queryByTestId("screen-colors-palette-mine")).not.toBeInTheDocument();
    });

    it("lists the files once they arrive and applies one when it is chosen", async () => {
      const { state } = setup({ devicePalettes: [installed], selectedId: "mine" });
      const row = screen.getByTestId("screen-colors-palette-mine");
      expect(row).toHaveTextContent("a-very-long-palette-filename.vpl");
      expect(row).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(row);
      await waitFor(() => expect(state.apply).toHaveBeenCalledWith(installed));
    });
  });

  it("says which palette the machine itself is on, separately from the selection", () => {
    // With the Remote target the app's own selection does not move, so the tick alone would never
    // show where the palette landed.
    setup({
      target: "remote",
      selectedId: "cool",
      isOnDevice: vi.fn((palette: VicPalette) => palette.id === "night"),
    });

    expect(screen.getByTestId("screen-colors-palette-night-on-device")).toHaveTextContent("On the C64");
    expect(screen.queryByTestId("screen-colors-palette-cool-on-device")).toBeNull();
  });
});

/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { PlaybackEngineToggle } from "@/pages/playFiles/components/PlaybackEngineToggle";
import { LOCAL_DEVICE_LABEL, SOURCE_LABELS, connectedDeviceLabel } from "@/lib/sourceNavigation/sourceTerms";

/*
 * The three options live in a popover now: the control on the card is a single output chip, so a
 * test that wants an option has to open it first. The chip carries `playback-engine-toggle`, the
 * testid the options used to sit under, so the HIL harness still finds the control itself.
 */
const renderChooser = () => {
  render(<PlaybackEngineToggle />);
  fireEvent.click(screen.getByTestId("playback-engine-toggle"));
};

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: (id: string) => ({ value: id === "live_view_enabled" || id === "audio_mirror_enabled" }),
}));

const mirror = {
  audioLive: false,
  session: { startAudio: vi.fn().mockResolvedValue(undefined), stopAudio: vi.fn().mockResolvedValue(undefined) },
};
vi.mock("@/hooks/useAvMirror", () => ({ useAvMirror: () => mirror }));

const savedDevice = vi.hoisted(() => ({ current: null as { name?: string } | null }));
vi.mock("@/lib/savedDevices/store", () => ({
  getSelectedSavedDevice: () => savedDevice.current,
}));

/**
 * One name and one icon per device, everywhere.
 *
 * The same machine used to appear as "C64" on the Play page, "C64 Ultimate" on
 * playlist rows and "C64U" in the disks list, drawn once as a lucide chip glyph
 * and once as the breadbin from the source picker. This device was "Local" in
 * one place and "This device" in another.
 */
describe("device naming and iconography", () => {
  beforeEach(() => {
    localStorage.clear();
    savedDevice.current = null;
  });
  afterEach(() => cleanup());

  it("does not name the machine on the listen-target buttons", () => {
    // Amended deliberately. These three buttons now read Local / Remote / Both, a progression rather
    // than a device list: the header already says which machine is connected, so naming it here spent
    // the row's width on something already on screen — and "Remote" matches Remote Input. Which
    // machine is which is still told apart by name everywhere the choice is actually between machines.
    savedDevice.current = { name: "u64" };

    renderChooser();

    expect(screen.getByTestId("playback-engine-c64")).toHaveTextContent("C64");
    expect(screen.getByTestId("playback-engine-c64")).not.toHaveTextContent("u64");
  });

  it("uses the same wording whether or not a device name is known", () => {
    renderChooser();

    expect(screen.getByTestId("playback-engine-c64")).toHaveTextContent("C64");
    expect(screen.getByTestId("playback-engine-c64")).not.toHaveTextContent(SOURCE_LABELS.c64u);
  });

  /*
   * Amended deliberately, and the invariant narrowed rather than dropped.
   *
   * This row asks where the SOUND comes out; the source picker asks which FILES you are browsing.
   * Reusing "Local" for both named two different things with one word, and it is also wrong on the
   * desktop web app, where "this device" is not a phone. "Here" is true of every host the app runs
   * on and, at four characters, is what lets all three options hold one 44px row at the largest
   * Text size. The guard that still matters — one machine must not appear under several names —
   * is asserted below for the C64 side, which is where that bug actually happened.
   */
  it("names the near sink Here, not the source picker's file-source word", () => {
    renderChooser();

    expect(screen.getByTestId("playback-engine-local")).toHaveTextContent("Here");
    expect(screen.getByTestId("playback-engine-local")).not.toHaveTextContent(LOCAL_DEVICE_LABEL);
    expect(LOCAL_DEVICE_LABEL).toBe(SOURCE_LABELS.local);
  });

  it("draws no icon at all on the listen-target row", () => {
    // Amended deliberately, and narrowed rather than deleted. The row is now an equal-width grid so
    // it holds one line at 320 CSS px, and a third of that row cannot fit an icon beside its label —
    // "Remote" overflowed its column by 9.4px (docs/plans/segmented-control/PROPOSAL.md §3a).
    //
    // Narrowed again now that the control is an output chip. The guard exists to stop a lucide
    // stand-in being drawn for a MACHINE that already has canonical artwork, and that still holds:
    // no origin icon may appear on the chip or on any option. The chip's own speaker glyph is not a
    // device icon — it is what makes a small pill read as an audio output rather than a filter — so
    // it is allowed, and the assertion below is about origin artwork rather than any svg at all.
    renderChooser();

    const chip = screen.getByTestId("playback-engine-toggle");
    expect(within(chip).queryByTestId("file-origin-icon")).toBeNull();
    expect(chip.querySelector("img")).toBeNull();
    for (const testId of ["playback-engine-local", "playback-engine-c64", "playback-listen-both"]) {
      const option = screen.queryByTestId(testId);
      if (!option) continue;
      expect(within(option).queryByTestId("file-origin-icon")).toBeNull();
      expect(option.querySelector("svg")).toBeNull();
      expect(option.querySelector("img")).toBeNull();
    }
  });

  it("resolves the connected label the same way wherever it is asked", () => {
    expect(connectedDeviceLabel("  c64u  ")).toBe("c64u");
    expect(connectedDeviceLabel("")).toBe(SOURCE_LABELS.c64u);
    expect(connectedDeviceLabel(null)).toBe(SOURCE_LABELS.c64u);
    expect(connectedDeviceLabel()).toBe(SOURCE_LABELS.c64u);
  });
});
